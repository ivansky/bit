import { CLIAspect, CLIMain, MainRuntime } from '@teambit/cli';
import { DependencyResolverAspect, DependencyResolverMain } from '@teambit/dependency-resolver';
import { BitId } from '@teambit/legacy-bit-id';
import WorkspaceAspect, { Workspace } from '@teambit/workspace';
import { uniqBy } from 'lodash';
import ComponentAspect, { Component, ComponentID, ComponentMain } from '@teambit/component';
import { ComponentIdObj } from '@teambit/component-id';
import GraphqlAspect, { GraphqlMain } from '@teambit/graphql';
import RefactoringAspect, { MultipleStringsReplacement, RefactoringMain } from '@teambit/refactoring';
import pMapSeries from 'p-map-series';
import PkgAspect, { PkgMain } from '@teambit/pkg';
import { BitError } from '@teambit/bit-error';
import NewComponentHelperAspect, { NewComponentHelperMain } from '@teambit/new-component-helper';
import { ForkCmd, ForkOptions } from './fork.cmd';
import { ForkingAspect } from './forking.aspect';
import { ForkingFragment } from './forking.fragment';
import { forkingSchema } from './forking.graphql';

export type ForkInfo = {
  forkedFrom: ComponentID;
};

type MultipleComponentsToFork = Array<{
  sourceId: string;
  targetId?: string; // if not specify, it'll be the same as the source
  path?: string; // if not specify, use the default component path
}>;

type MultipleForkOptions = {
  refactor?: boolean;
  scope?: string; // different scope-name than the original components
  install?: boolean; // whether to run "bit install" once done.
};

export class ForkingMain {
  constructor(
    private workspace: Workspace,
    private dependencyResolver: DependencyResolverMain,
    private newComponentHelper: NewComponentHelperMain,
    private refactoring: RefactoringMain,
    private pkg: PkgMain
  ) {}

  /**
   * create a new copy of existing/remote component.
   * the new component holds a reference to the old one for future reference.
   * if refactor option is enable, change the source-code to update all dependencies with the new name.
   */
  async fork(sourceId: string, targetId?: string, options?: ForkOptions): Promise<ComponentID> {
    const sourceCompId = await this.workspace.resolveComponentId(sourceId);
    const exists = this.workspace.exists(sourceCompId);
    if (exists) {
      const existingInWorkspace = await this.workspace.get(sourceCompId);
      return this.forkExistingInWorkspace(existingInWorkspace, targetId, options);
    }
    const sourceIdWithScope = sourceCompId._legacy.scope
      ? sourceCompId
      : ComponentID.fromLegacy(BitId.parse(sourceId, true));
    const { targetCompId, component } = await this.forkRemoteComponent(sourceIdWithScope, targetId, options);
    await this.saveDeps(component);
    await this.installDeps();
    return targetCompId;
  }

  /**
   * get the forking data, such as the source where a component was forked from
   */
  getForkInfo(component: Component): ForkInfo | null {
    const forkConfig = component.state.aspects.get(ForkingAspect.id)?.config as ForkConfig | undefined;
    if (!forkConfig) return null;
    return {
      forkedFrom: ComponentID.fromObject(forkConfig.forkedFrom),
    };
  }

  async forkMultipleFromRemote(componentsToFork: MultipleComponentsToFork, options: MultipleForkOptions = {}) {
    const { scope } = options;
    const results = await pMapSeries(componentsToFork, async ({ sourceId, targetId, path }) => {
      const sourceCompId = await this.workspace.resolveComponentId(sourceId);
      const sourceIdWithScope = sourceCompId._legacy.scope
        ? sourceCompId
        : ComponentID.fromLegacy(BitId.parse(sourceId, true));
      const { targetCompId, component } = await this.forkRemoteComponent(sourceIdWithScope, targetId, { scope, path });
      return { targetCompId, sourceId, component };
    });
    const oldPackages: string[] = [];
    const stringsToReplace: MultipleStringsReplacement = results
      .map(({ targetCompId, sourceId, component }) => {
        const oldPackageName = this.pkg.getPackageName(component);
        oldPackages.push(oldPackageName);
        const newName = targetCompId.fullName.replace(/\//g, '.');
        const scopeToReplace = targetCompId.scope.replace('.', '/');
        const newPackageName = `@${scopeToReplace}.${newName}`;
        return [
          { oldStr: oldPackageName, newStr: newPackageName },
          { oldStr: sourceId, newStr: targetCompId.toStringWithoutVersion() },
        ];
      })
      .flat();
    const allComponents = await this.workspace.list();
    if (options.refactor) {
      const { changedComponents } = await this.refactoring.replaceMultipleStrings(allComponents, stringsToReplace);
      await Promise.all(changedComponents.map((comp) => this.workspace.write(comp)));
    }
    const forkedComponents = results.map((result) => result.component);
    const policy = await Promise.all(forkedComponents.map((comp) => this.extractDeps(comp)));
    const policyFlatAndUnique = uniqBy(policy.flat(), 'dependencyId');
    const policyWithoutWorkspaceComps = policyFlatAndUnique.filter((dep) => !oldPackages.includes(dep.dependencyId));
    this.dependencyResolver.addToRootPolicy(policyWithoutWorkspaceComps, { updateExisting: true });
    await this.dependencyResolver.persistConfig(this.workspace.path);
    if (options.install) {
      await this.installDeps();
    }
  }

  private async forkExistingInWorkspace(existing: Component, targetId?: string, options?: ForkOptions) {
    if (!targetId) {
      throw new Error(`error: unable to create "${existing.id.toStringWithoutVersion()}" component, a component with the same name already exists.
please specify the target-id arg`);
    }
    const targetCompId = this.newComponentHelper.getNewComponentId(targetId, undefined, options?.scope);

    const config = await this.getConfig(existing);
    await this.newComponentHelper.writeAndAddNewComp(existing, targetCompId, options, config);
    if (options?.refactor) {
      const allComponents = await this.workspace.list();
      const { changedComponents } = await this.refactoring.refactorDependencyName(allComponents, existing.id, targetId);
      await Promise.all(changedComponents.map((comp) => this.workspace.write(comp)));
    }
    return targetCompId;
  }

  private async forkRemoteComponent(
    sourceId: ComponentID,
    targetId?: string,
    options?: ForkOptions
  ): Promise<{
    targetCompId: ComponentID;
    component: Component;
  }> {
    if (options?.refactor) {
      throw new BitError(`the component ${sourceId.toStringWithoutVersion()} is not in the workspace, you can't use the --refactor flag.
the reason is that the refactor changes the components using ${sourceId.toStringWithoutVersion()}, since it's not in the workspace, no components were using it, so nothing to refactor`);
    }
    const targetName = targetId || sourceId.fullName;
    const targetCompId = this.newComponentHelper.getNewComponentId(targetName, undefined, options?.scope);
    const component = await this.workspace.scope.getRemoteComponent(sourceId);
    const config = await this.getConfig(component);
    await this.newComponentHelper.writeAndAddNewComp(component, targetCompId, options, config);

    return { targetCompId, component };
  }

  private async saveDeps(component: Component) {
    const workspacePolicyEntries = await this.extractDeps(component);
    this.dependencyResolver.addToRootPolicy(workspacePolicyEntries, { updateExisting: true });
    await this.dependencyResolver.persistConfig(this.workspace.path);
  }

  private async installDeps() {
    await this.workspace.install(undefined, {
      dedupe: true,
      import: false,
      copyPeerToRuntimeOnRoot: true,
      copyPeerToRuntimeOnComponents: false,
      updateExisting: false,
    });
  }

  private async extractDeps(component: Component) {
    const deps = await this.dependencyResolver.getDependencies(component);
    return deps
      .filter((dep) => dep.source === 'auto')
      .map((dep) => ({
        dependencyId: dep.getPackageName?.() || dep.id,
        lifecycleType: dep.lifecycle === 'dev' ? 'runtime' : dep.lifecycle,
        value: {
          version: dep.version,
        },
      }));
  }

  private async getConfig(comp: Component) {
    const fromExisting = await this.newComponentHelper.getConfigFromExistingToNewComponent(comp);
    return {
      ...fromExisting,
      [ForkingAspect.id]: {
        forkedFrom: comp.id.toObject(),
      },
    };
  }

  static slots = [];
  static dependencies = [
    CLIAspect,
    WorkspaceAspect,
    DependencyResolverAspect,
    ComponentAspect,
    NewComponentHelperAspect,
    GraphqlAspect,
    RefactoringAspect,
    PkgAspect,
  ];
  static runtime = MainRuntime;
  static async provider([
    cli,
    workspace,
    dependencyResolver,
    componentMain,
    newComponentHelper,
    graphql,
    refactoring,
    pkg,
  ]: [
    CLIMain,
    Workspace,
    DependencyResolverMain,
    ComponentMain,
    NewComponentHelperMain,
    GraphqlMain,
    RefactoringMain,
    PkgMain
  ]) {
    const forkingMain = new ForkingMain(workspace, dependencyResolver, newComponentHelper, refactoring, pkg);
    cli.register(new ForkCmd(forkingMain));
    graphql.register(forkingSchema(forkingMain));
    componentMain.registerShowFragments([new ForkingFragment(forkingMain)]);
    return forkingMain;
  }
}

ForkingAspect.addRuntime(ForkingMain);

export type ForkConfig = {
  forkedFrom: ComponentIdObj;
};
