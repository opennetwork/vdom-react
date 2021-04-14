import type { RenderOptions as DOMRenderOptions } from "@opennetwork/vdom";
import type { Tree, VNode } from "@opennetwork/vnode";
import { DOMNativeVNode, DOMVContext, ElementDOMNativeVNode } from "@opennetwork/vdom";
import { SimpleSignal } from "./cancellable";
import type { Controller, RenderMeta } from "./controller";
import { Collector } from "microtask-collector";
import { DeferredAction, DeferredActionIterator } from "./queue";
import { State, StateContainer } from "./state";
import { ReactContextMap } from "./node";
import { createReactDispatcher, Dispatcher } from "./dispatcher";
import { ComponentInstanceMap } from "./component";
import { CreateVNodeFn as CreateVNodeFnPrototype } from "@opennetwork/vnode/dist/create-node";

interface RenderDetails {
  remainingRootsToFlush?: number;
}

export interface RenderContextOptions extends DOMRenderOptions {
  promise(promise: Promise<unknown>, node: VNode, tree?: Tree): void;
  rendered?(details: RenderDetails): Promise<void> | void;
  actions?: Collector<DeferredAction>;
  parent?: RenderContext;
  stateChanges?: Collector<State>;
  maxIterations?: number;
  contextMap: ReactContextMap;
  // Returns false if error should be ignored, or true to throw it further
  errorBoundary(error: unknown): boolean;
  createVNode: CreateVNodeFn;
}

export interface RenderOptions extends RenderContextOptions {
  context: RenderContext;
}

export interface CreateVNodeFn extends CreateVNodeFnPrototype<RenderOptions, VNode, ElementDOMNativeVNode, DOMNativeVNode> {
  (source: VNode, options: RenderOptions): DOMNativeVNode;
}

export type CreateVNodeFnCatch<Fn extends CreateVNodeFn> = Fn;

export interface RenderContext<P = unknown> extends Controller {
  options: RenderContextOptions;
  currentState: State;
  previousState?: StateContainer;
  previousProps?: P;
  currentProps?: P;
  actions: Collector<DeferredAction>;
  dispatcher: Dispatcher;
  parent?: RenderContext;
  controller?: Controller;
  rendering?: Promise<void>;
  createVNode: CreateVNodeFn;
  continueFlag?: () => boolean;
  isDestroyable: boolean;
  destroyed: boolean;
  actionsIterator: DeferredActionIterator;
  instance: ComponentInstanceMap<P>;
  source: () => unknown;
  yielded: boolean;
}

export class RenderContext<P = unknown> extends DOMVContext implements RenderContext<P> {

  readonly #signal = new SimpleSignal();
  readonly #promise;

  readonly #nodes = new Set<DOMNativeVNode>();

  dispatcher;
  actionsIterator: DeferredActionIterator;
  actions;

  options: RenderContextOptions;
  currentState: State;
  previousState?: StateContainer;
  previousProps?: P;
  currentProps?: P;
  parent?: RenderContext;
  controller?: Controller;
  rendering?: Promise<void>;
  createVNode: CreateVNodeFn;

  continueFlag?: () => boolean;
  isDestroyable = false;

  destroyed = false;

  instance: ComponentInstanceMap<P> = new Map();
  source: () => unknown;
  yielded: boolean;

  get aborted() {
    return this.#signal.aborted;
  }

  hello?(renderContext: RenderContext, node: DOMNativeVNode) {
    this.#nodes.add(node);
  }

  willContinue?(renderContext: RenderContext, meta: RenderMeta): boolean | Promise<boolean>;
  beforeRender?(renderContext: RenderContext, meta: RenderMeta): boolean | Promise<boolean>;
  afterRender?(renderContext: RenderContext, meta: RenderMeta, willContinue: boolean): boolean | Promise<boolean>;
  beforeDestroyed?(renderContext: RenderContext): void | Promise<void>;
  afterDestroyed?(renderContext: RenderContext): void | Promise<void>;

  constructor(options: RenderContextOptions) {
    super(options);

    this.options = options;
    this.controller = this;

    this.parent = options.parent;

    this.#promise = options.promise;

    this.dispatcher = createReactDispatcher({
      contextMap: options.contextMap,
      actions: options.actions,
      stateChanges: options.stateChanges,
    });
    this.actions = this.dispatcher.actions;
    this.actionsIterator = this.actions[Symbol.asyncIterator]();
    this.createVNode = options.createVNode;
  }

  hydrate(node: VNode, tree?: Tree): Promise<void> {
    return super.hydrate(node, tree);
  }

  async close() {
    this.isDestroyable = true;
    this.destroyed = true;
    await this.controller.beforeDestroyed?.(this);
    await this.dispatcher.destroyHookEffectList(0);
    await this.controller.afterDestroyed?.(this);
    this.dispatcher.actions.close();
    return super.close();
  }

}
