import PubsubAspect, { PubsubMain } from '@teambit/pubsub';
import { MainRuntime } from '@teambit/cli';
import { Component, ComponentAspect } from '@teambit/component';
import { EnvsAspect, EnvsMain } from '@teambit/envs';
import { GraphqlAspect, GraphqlMain } from '@teambit/graphql';
import { DependencyResolverAspect, DependencyResolverMain } from '@teambit/dependency-resolver';
import { Slot, SlotRegistry } from '@teambit/harmony';
import { BrowserRuntime } from './browser-runtime';
import { BundlerAspect } from './bundler.aspect';
import { ComponentServer } from './component-server';
import { BundlerContext } from './bundler-context';
import { devServerSchema } from './dev-server.graphql';
import { DevServerService } from './dev-server.service';

export type BrowserRuntimeSlot = SlotRegistry<BrowserRuntime>;

export type BundlerConfig = {
  dedicatedEnvDevServers: string[];
};

/**
 * bundler extension.
 */
export class BundlerMain {
  constructor(
    readonly config: BundlerConfig,
    /**
     * Pubsub extension.
     */
    private pubsub: PubsubMain,

    /**
     * environments extension.
     */
    private envs: EnvsMain,

    /**
     * dev server service.
     */
    private devService: DevServerService,

    /**
     * browser runtime slot.
     */
    private runtimeSlot: BrowserRuntimeSlot
  ) {}

  /**
   * load all given components in corresponding dev servers.
   * @param components defaults to all components in the workspace.
   */
  async devServer(components: Component[]): Promise<ComponentServer[]> {
    const envRuntime = await this.envs.createEnvironment(components);
    // TODO: this must be refactored away from here. this logic should be in the Preview.
    const servers: ComponentServer[] = await envRuntime.runOnce<ComponentServer[]>(this.devService, {
      dedicatedEnvDevServers: this.config.dedicatedEnvDevServers,
    });
    this._componentServers = servers;

    this.indexByComponent();

    return this._componentServers;
  }

  /**
   * get a dev server instance containing a component.
   * @param component
   */
  getComponentServer(component: Component): undefined | ComponentServer {
    if (!this._componentServers) return undefined;
    const envId = this.envs.getEnvId(component);
    const server = this._componentServers.find(
      (componentServer) =>
        componentServer.context.relatedContexts.includes(envId) || componentServer.context.id === envId
    );

    return server;
  }

  /**
   * compute entry files for bundling components in a given execution context.
   */
  async computeEntries(context: BundlerContext) {
    const slotEntries = await Promise.all(
      this.runtimeSlot.values().map(async (browserRuntime) => browserRuntime.entry(context))
    );

    const slotPaths = slotEntries.reduce((acc, current) => {
      acc = acc.concat(current);
      return acc;
    });

    return slotPaths;
  }

  /**
   * register a new browser runtime environment.
   * @param browserRuntime
   */
  registerTarget(browserRuntime: BrowserRuntime[]) {
    browserRuntime.map((runtime) => {
      return this.runtimeSlot.register(runtime);
    });

    return this;
  }

  /**
   * component servers.
   */
  private _componentServers: null | ComponentServer[];

  private indexByComponent() {}

  static slots = [Slot.withType<BrowserRuntime>()];

  static runtime = MainRuntime;
  static dependencies = [PubsubAspect, EnvsAspect, GraphqlAspect, DependencyResolverAspect, ComponentAspect];

  static defaultConfig = {
    dedicatedEnvDevServers: [],
  };

  static async provider(
    [pubsub, envs, graphql, dependencyResolver]: [PubsubMain, EnvsMain, GraphqlMain, DependencyResolverMain],
    config,
    [runtimeSlot]: [BrowserRuntimeSlot]
  ) {
    const devServerService = new DevServerService(pubsub, dependencyResolver, runtimeSlot);
    const bundler = new BundlerMain(config, pubsub, envs, devServerService, runtimeSlot);
    envs.registerService(devServerService);

    graphql.register(devServerSchema(bundler));

    return bundler;
  }
}

BundlerAspect.addRuntime(BundlerMain);
