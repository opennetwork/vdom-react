import type { RenderOptions as DOMRenderOptions } from "@opennetwork/vdom";
import { NativeVNode, DOMVContext, DOMNativeVNode, Native } from "@opennetwork/vdom";
import type { Tree, VNode } from "@opennetwork/vnode";
import { Fragment, hydrateChildren } from "@opennetwork/vnode";
import { SimpleSignal } from "./cancellable";
import type { Controller, RenderMeta } from "./controller";
import { Collector } from "microtask-collector";
import { DeferredAction, DeferredActionIterator } from "./queue";
import { State, StateContainer } from "./state";
import { ReactContextMap } from "./node";
import { createReactDispatcher } from "./dispatcher";
import { ComponentInstanceMap } from "./component";
import { CreateVNodeFn as CreateVNodeFnPrototype } from "@opennetwork/vnode/dist/create-node";
import { renderGenerator } from "./render";

export interface RenderContextOptions extends DOMRenderOptions {
  promise(promise: Promise<unknown>, node: VNode, tree?: Tree): void;
  rendered?(): Promise<void> | void;
  actions?: Collector<DeferredAction>;
  parent?: RenderContext;
  stateChanges?: Collector<[RenderContext, State]>;
  maxIterations?: number;
  contextMap: ReactContextMap;
  // Returns false if error should be ignored, or true to throw it further
  errorBoundary(error: unknown): boolean;
  createVNode: CreateVNodeFn;
}

export interface RenderSourceContextOptions<P = unknown> extends RenderContextOptions {
  source?: () => void;
  initialProps?: P;
}

export interface CreateRenderContextOptions extends RenderContextOptions {
  createChildContext(source: () => unknown, props: unknown): RenderContext;
}

export interface CreateVNodeFn extends CreateVNodeFnPrototype<CreateRenderContextOptions, VNode, DOMNativeVNode, NativeVNode> {
  (source: VNode, options: CreateRenderContextOptions): NativeVNode;
}

export type CreateVNodeFnCatch<Fn extends CreateVNodeFn> = Fn;

export interface RenderVNode extends VNode {
  children: AsyncIterable<DOMNativeVNode[]>;
}

export class RenderContext<P = unknown> extends DOMVContext implements RenderContext<P>, RenderVNode {

  readonly reference: typeof Fragment = Fragment;

  readonly #signal = new SimpleSignal();
  readonly #promise;

  readonly #nodes = new Set<NativeVNode>();

  #snapshot: DOMNativeVNode[] | undefined;

  get snapshot() {
    return this.#snapshot;
  }

  dispatcher;
  #actionsIterator: DeferredActionIterator;

  get actionsIterator() {
    return this.#actionsIterator;
  }

  set actionsIterator(value: DeferredActionIterator | undefined) {
    this.#actionsIterator = value ?? this.actions[Symbol.asyncIterator]();
  }

  actions;

  options: RenderSourceContextOptions<P>;
  currentState: State;
  previousState?: StateContainer;
  previousProps?: P;

  #currentProps?: P;

  get currentProps(): P {
    return this.#currentProps ?? this.previousProps;
  }

  set currentProps(value: P) {
    this.#currentProps = value;
    this.dispatcher.actions.add(() => this.dispatcher.state.change());
  }

  parent?: RenderContext;
  controller?: Controller;
  rendering?: Promise<void>;
  createVNode: CreateVNodeFn;

  isDestroyable = false;

  destroyed = false;

  functionComponentInstances: TransformInstanceMap = new Map();
  functionComponentInstanceIndex: TransformInstanceMapIndex = new Map();
  classComponentInstances: ComponentInstanceMap<P> = new Map();
  source: () => unknown;
  yielded = false;

  contexts = new Set<RenderContext>();

  get nodes() {
    return [...this.#nodes];
  }

  get hooked() {
    if (this.dispatcher.hooked) {
      return true;
    }
    for (const child of this.contexts) {
      if (child.hooked) {
        return true;
      }
    }
    return false;
  }

  get aborted() {
    return this.#signal.aborted;
  }

  hello?(renderContext: RenderContext, node: NativeVNode) {
    this.#nodes.add(node);
  }

  willContinue?(renderContext: RenderContext, meta: RenderMeta);
  willContinue?() {
    return !!this.options.promise;
  }

  beforeRender?(renderContext: RenderContext, meta: RenderMeta): boolean | Promise<boolean>;

  afterRender?(renderContext: RenderContext, meta: RenderMeta, willContinue: boolean): boolean | Promise<boolean>;
  async afterRender?() {

    return true;
  }


  beforeDestroyed?(renderContext: RenderContext): void | Promise<void>;
  afterDestroyed?(renderContext: RenderContext): void | Promise<void>;

  constructor(options: RenderSourceContextOptions<P>) {
    super(options);

    this.options = options;
    this.controller = this;

    this.parent = options.parent;

    this.#promise = options.promise;

    this.dispatcher = createReactDispatcher({
      contextMap: options.contextMap,
      actions: options.actions,
      stateChanges: options.stateChanges,
      renderContext: this,
    });
    this.actions = this.dispatcher.actions;
    this.actionsIterator = this.actions[Symbol.asyncIterator]();
    this.createVNode = options.createVNode;
    this.currentState = this.dispatcher.state;
    this.previousState = {
      ...this.dispatcher.state.container,
      symbol: Symbol("Initial")
    };
    this.previousProps = options.initialProps;
    this.source = options.source;

    if (this.source) {
      this.hello(this, Native({}, this));
    }
  }

  createChildRenderContextOptions(options: Partial<RenderContextOptions>): CreateRenderContextOptions {
    const parent = this;
    const resolvedOptions = {
      ...parent.options,
      ...options
    };
    return {
      ...resolvedOptions,
      createChildContext(source: () => unknown, props: unknown): RenderContext {
        return parent.createChildContext({
          ...resolvedOptions,
          source,
          initialProps: props
        });
      }
    };
  }

  createChildContext(options: RenderSourceContextOptions): RenderContext {
    const context = new RenderContext({
      ...options,
      parent: this
    });
    this.contexts.add(context);
    return context;
  }

  hydrate(node: VNode, tree?: Tree): Promise<void> {
    return super.hydrate(node, tree);
  }

  async commitChildren(documentNode: Element, node: VNode, tree?: Tree) {

    const { promise } = this.options;
    const resultPromise = hydrateChildren(this.childContext(documentNode), node, tree);

    if (!promise) {
      await resultPromise;
    } else {
      promise(resultPromise, node, tree);
    }

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

  getInstance(source: Function, create: () => NativeVNode): NativeVNode {
    const indexCounter = this.functionComponentInstanceIndex.get(source) ?? new Counter();
    this.functionComponentInstanceIndex.set(source, indexCounter);
    indexCounter.next();
    const { index } = indexCounter;
    const currentInstances = this.functionComponentInstances.get(source) ?? [];
    if (currentInstances[index]) {
      return currentInstances[index];
    }
    const nextInstance = create();
    currentInstances[index] = nextInstance;
    this.functionComponentInstances.set(source, currentInstances);
    return nextInstance;
  }

  get children() {
    const renderContext = this;
    const setSnapshot = (snapshot: DOMNativeVNode[]) => {
      this.#snapshot = snapshot;
    };

    return {
      [Symbol.asyncIterator]: generator
    };

    async function *generator() {
      if (renderContext.isDestroyable || renderContext.destroyed) {
        return;
      }
      let yielded = false;
      for await (const nextChildren of renderGenerator(renderContext)) {
        setSnapshot(nextChildren);
        yield nextChildren;
        yielded = renderContext.yielded = true;
      }
      const snapshot = renderContext.snapshot;
      if (!yielded && renderContext.yielded && snapshot) {
        yield snapshot;
      }
    }
  }

}

type TransformInstanceMap = Map<Function, NativeVNode[]>;
type TransformInstanceMapIndex = Map<Function, Counter>;

class Counter {
  #index = -1;
  constructor() {
    this.reset();
  }
  get index() {
    return this.#index;
  }
  reset() {
    this.#index = -1;
  }
  next() {
    return this.#index += 1;
  }
}
