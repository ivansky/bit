import { CLIAspect, CLIMain, MainRuntime } from '@teambit/cli';
import { IssuesClasses } from '@teambit/component-issues';
import WorkspaceAspect, { Workspace } from '@teambit/workspace';
import { Analytics } from '@teambit/legacy/dist/analytics/analytics';
import { BitId, BitIds } from '@teambit/legacy/dist/bit-id';
import loader from '@teambit/legacy/dist/cli/loader';
import { BEFORE_STATUS } from '@teambit/legacy/dist/cli/loader/loader-messages';
import ConsumerComponent from '@teambit/legacy/dist/consumer/component';
import ComponentsPendingImport from '@teambit/legacy/dist/consumer/component-ops/exceptions/components-pending-import';
import ComponentsList, { DivergedComponent } from '@teambit/legacy/dist/consumer/component/components-list';
import { InvalidComponent } from '@teambit/legacy/dist/consumer/component/consumer-component';
import { ModelComponent } from '@teambit/legacy/dist/scope/models';
import { ConsumerNotFound } from '@teambit/legacy/dist/consumer/exceptions';
import { InsightsAspect, InsightsMain } from '@teambit/insights';
import IssuesAspect, { IssuesMain } from '@teambit/issues';
import { StatusCmd } from './status-cmd';
import { StatusAspect } from './status.aspect';

export type StatusResult = {
  newComponents: ConsumerComponent[];
  modifiedComponent: ConsumerComponent[];
  stagedComponents: ModelComponent[];
  componentsWithIssues: ConsumerComponent[];
  importPendingComponents: BitId[];
  autoTagPendingComponents: BitId[];
  invalidComponents: InvalidComponent[];
  outdatedComponents: ConsumerComponent[];
  mergePendingComponents: DivergedComponent[];
  componentsDuringMergeState: BitIds;
  componentsWithIndividualFiles: ConsumerComponent[];
  componentsWithTrackDirs: ConsumerComponent[];
  softTaggedComponents: BitId[];
  snappedComponents: BitId[];
  laneName: string | null; // null if default
};

export class StatusMain {
  constructor(private workspace: Workspace, private issues: IssuesMain, private insights: InsightsMain) {}

  async status(): Promise<StatusResult> {
    if (!this.workspace) throw new ConsumerNotFound();
    loader.start(BEFORE_STATUS);
    const consumer = this.workspace.consumer;
    const laneObj = await consumer.getCurrentLaneObject();
    const componentsList = new ComponentsList(consumer);
    const newComponents: ConsumerComponent[] = (await componentsList.listNewComponents(true)) as ConsumerComponent[];
    const modifiedComponent = (await componentsList.listModifiedComponents(true)) as ConsumerComponent[];
    const stagedComponents: ModelComponent[] = await componentsList.listExportPendingComponents(laneObj);
    const autoTagPendingComponents = await componentsList.listAutoTagPendingComponents();
    const autoTagPendingComponentsIds = autoTagPendingComponents.map((component) => component.id);
    const allInvalidComponents = await componentsList.listInvalidComponents();
    const importPendingComponents = allInvalidComponents
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      .filter((c) => c.error instanceof ComponentsPendingImport)
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      .map((i) => i.id);
    // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
    const invalidComponents = allInvalidComponents.filter((c) => !(c.error instanceof ComponentsPendingImport));
    const outdatedComponents = await componentsList.listOutdatedComponents();
    const mergePendingComponents = await componentsList.listMergePendingComponents();
    const newAndModifiedLegacy: ConsumerComponent[] = newComponents.concat(modifiedComponent);
    const issuesToIgnore = this.issues.getIssuesToIgnoreGlobally();
    if (!this.workspace.isLegacy && newAndModifiedLegacy.length) {
      const newAndModified = await this.workspace.getManyByLegacy(newAndModifiedLegacy);
      if (!issuesToIgnore.includes(IssuesClasses.CircularDependencies.name)) {
        await this.insights.addInsightsAsComponentIssues(newAndModified);
      }
      this.issues.removeIgnoredIssuesFromComponents(newAndModified);
    }
    const componentsWithIssues = newAndModifiedLegacy.filter((component: ConsumerComponent) => {
      if (consumer.isLegacy && component.issues) {
        component.issues.delete(IssuesClasses.RelativeComponentsAuthored);
      }
      return component.issues && !component.issues.isEmpty();
    });
    const componentsDuringMergeState = componentsList.listDuringMergeStateComponents();
    const softTaggedComponents = componentsList.listSoftTaggedComponents();
    const snappedComponents = (await componentsList.listSnappedComponentsOnMain()).map((c) => c.toBitId());
    const currentLane = consumer.getCurrentLaneId();
    const laneName = currentLane.isDefault() ? null : currentLane.name;
    Analytics.setExtraData('new_components', newComponents.length);
    Analytics.setExtraData('staged_components', stagedComponents.length);
    Analytics.setExtraData('num_components_with_missing_dependencies', componentsWithIssues.length);
    Analytics.setExtraData('autoTagPendingComponents', autoTagPendingComponents.length);
    Analytics.setExtraData('deleted', invalidComponents.length);
    await consumer.onDestroy();
    return {
      newComponents: ComponentsList.sortComponentsByName(newComponents),
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      modifiedComponent: ComponentsList.sortComponentsByName(modifiedComponent),
      stagedComponents: ComponentsList.sortComponentsByName(stagedComponents),
      componentsWithIssues, // no need to sort, we don't print it as is
      importPendingComponents, // no need to sort, we use only its length
      autoTagPendingComponents: ComponentsList.sortComponentsByName(autoTagPendingComponentsIds),
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      invalidComponents,
      outdatedComponents,
      mergePendingComponents,
      componentsDuringMergeState,
      componentsWithIndividualFiles: await componentsList.listComponentsWithIndividualFiles(),
      componentsWithTrackDirs: await componentsList.listComponentsWithTrackDir(),
      softTaggedComponents,
      snappedComponents,
      laneName,
    };
  }

  static slots = [];
  static dependencies = [CLIAspect, WorkspaceAspect, InsightsAspect, IssuesAspect];
  static runtime = MainRuntime;
  static async provider([cli, workspace, insights, issues]: [CLIMain, Workspace, InsightsMain, IssuesMain]) {
    const statusMain = new StatusMain(workspace, issues, insights);
    cli.register(new StatusCmd(statusMain));
    return statusMain;
  }
}

StatusAspect.addRuntime(StatusMain);
