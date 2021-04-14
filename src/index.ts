import { ReactElement } from "react";
import { DOMNativeVNode, DOMVContext } from "@opennetwork/vdom";
import { createVNode } from "./node";
import { Fragment, hydrate } from "@opennetwork/vnode";
import { Collector } from "microtask-collector";
import { RenderContext } from "./context";
import { DeferredAction, DeferredActionCollector, DeferredActionIterator, DeferredActionIteratorResult } from "./queue";
import { State, StateContainer } from "./state";

export type {
  DOMNativeVNode,
  RenderContext
};

const contexts = new WeakMap<Element, RenderContext>();
const roots = new WeakMap<DOMVContext, RenderContext>();
const children = new WeakMap<RenderContext, Set<RenderContext>>();
const nodes = new WeakMap<RenderContext, DOMNativeVNode>();
const states = new WeakMap<State, RenderContext>();

interface RenderContextTree {
  context: RenderContext;
  node?: DOMNativeVNode;
  children: RenderContextTree[];
}

interface RenderDetails {
  remainingRootsToFlush?: number;
}

interface RenderOptions {
  rendered?(details: RenderDetails): Promise<void> | void;
  actions?: Collector<DeferredAction>;
  stateChanges?: Collector<State>;
  context?: RenderContext;
  maxIterations?: number;
}

export function render(node: ReactElement, root: Element, options: RenderOptions = {}): unknown {
  return renderAsync(node, root, options);
}

export async function renderAsync(element: ReactElement, root: Element, options: RenderOptions = {}): Promise<[DOMNativeVNode, RenderContext]> {
  const actions = options.actions ?? new Collector<DeferredAction>({
    eagerCollection: true
  });
  const stateChanges = options.stateChanges ?? new Collector<State>({
    eagerCollection: true
  });
  const stateChangeIterator = stateChanges[Symbol.asyncIterator]();

  const context = options.context ?? contexts.get(root) ?? new RenderContext({
    actions,
    stateChanges,
    contextMap: new Map(),
    errorBoundary: onAnyError,
    promise: unknownPromise,
    createVNode,
    root
  });
  contexts.set(root, context);

  let caughtError: unknown = undefined;
  const promises = new Set<Promise<unknown>>();
  let accumulativePromise: Promise<void> | undefined = wait(actions);

  const initialNativeNode = createVNodeFromElement(element);

  const rootQueue: DOMNativeVNode[] = [
    initialNativeNode
  ];

  let rootNativeNode: DOMNativeVNode | undefined;
  let tree: RenderContextTree | undefined;

  let remainingIterations = options.maxIterations;

  try {
    // Hydrate at least once no matter what
    do {
      if (remainingIterations) {
        remainingIterations -= 1;
      }

      rootNativeNode = rootQueue.shift();

      await hydrate(context, rootNativeNode);

      await options.rendered?.({
        remainingRootsToFlush: rootQueue.length
      });

      tree = buildTree(context);

      if (!anyHooked(context) || remainingIterations === 0) {
        // const state = { previousState: tree.children[0].context.previousState, currentState: tree.children[0].context.currentState };
        // console.log("None hooked", tree.children[0], state);
        break;
      }

      const { done, value } = await stateChangeIterator.next();

      console.log({ done, value: value.map((value: StateContainer) => value.symbol), context: value.map((value: State) => states.get(value)) });

      if (done) break;

      rootQueue.push(rootNativeNode);
    } while (rootQueue.length && !caughtError && (typeof remainingIterations !== "number" || remainingIterations > 0));
  } catch (error) {
    caughtError = caughtError ?? error;
  } finally {
    await context.close();
    await accumulativePromise;
    await Promise.all(promises);
  }

  if (caughtError) {
    throw caughtError;
  }

  return [rootNativeNode, context];

  function anyHooked(context: RenderContext): boolean {
    return (
      context.dispatcher.hooked ||
      [...context.children].findIndex(anyHooked) > -1
    );
  }

  function buildTree(context: RenderContext): RenderContextTree {
    const childrenArray = [...(children.get(context) ?? [])];
    return {
      context,
      node: nodes.get(context),
      children: childrenArray.map(buildTree)
    };
  }

  function createVNodeFromElement(element: ReactElement) {
    return createVNode(
      { reference: Fragment, source: element, options: {} },
      context.createChildRenderContextOptions({})
    );
  }

  async function wait(queue: DeferredActionCollector) {
    try {
      const iterator = queue[Symbol.asyncIterator]();
      let result: DeferredActionIteratorResult;
      do {
        result = await iterator.next();
        if (!result.done && Array.isArray(result.value)) {
          result.value.forEach(onDeferredAction);
        }
      } while (!result.done && !caughtError);
    } catch (error) {
      caughtError = caughtError ?? error;
    } finally {
      accumulativePromise = undefined;
    }
  }

  function onDeferredAction(action: DeferredAction) {
    knownPromise(runDeferredAction());

    async function runDeferredAction() {
      if (typeof action === "function") {
        await action();
      }
    }
  }

  function unknownPromise(promise: Promise<unknown>) {
    actions.add(() => promise);
  }

  function onAnyError(error: unknown) {
    caughtError = error;
    return true;
  }

  function knownPromise(promise: Promise<unknown>) {
    promises.add(promise);
    promise.then(onResolve, onError);
    function onError(error: unknown) {
      promises.delete(promise);
      onAnyError(error);
    }
    function onResolve() {
      promises.delete(promise);
    }
  }
}
