import { ReactElement } from "react";
import { DOMNativeVNode, DOMVContext } from "@opennetwork/vdom";
import { createVNode } from "./node";
import { Fragment, hydrate, Tree } from "@opennetwork/vnode";
import { Collector } from "microtask-collector";
import { ReactDOMVContext } from "./context";
import { RenderContext } from "./render";
import { DeferredAction, DeferredActionCollector, DeferredActionIterator, DeferredActionIteratorResult } from "./queue";
import { noop } from "./noop";
import { NeverEndingPromise, State, StateContainer } from "./state";

export type {
  DOMNativeVNode,
  ReactDOMVContext
};

const contexts = new WeakMap<Element, ReactDOMVContext>();
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
  rendered?(details: RenderDetails): Promise<void>;
  collector?: Collector<DeferredAction>;
  stateChanges?: Collector<State>;
  context?: ReactDOMVContext;
  maxIterations?: number;
}

export function render(node: ReactElement, root: Element, options: RenderOptions = {}): unknown {
  return renderAsync(node, root, options);
}

export async function renderAsync(element: ReactElement, root: Element, options: RenderOptions = {}): Promise<[DOMNativeVNode, ReactDOMVContext]> {
  const collector = options.collector ?? new Collector<DeferredAction>({
    eagerCollection: true
  });
  const stateChanges = options.stateChanges ?? new Collector<State>({
    eagerCollection: true
  });
  const stateChangeIterator = stateChanges[Symbol.asyncIterator]();

  const context = options.context ?? contexts.get(root) ?? new ReactDOMVContext({
    root,
    promise: unknownPromise
  });
  contexts.set(root, context);
  let rootRenderContext = roots.get(context);

  // We will operate on the assumptions that all nodes right now should just process one render
  // for a cycle, we can change this in the future for root nodes of active elements, but that's
  // not a concern for now
  context.willContinue = () => false;

  context.hello = (renderContext: RenderContext, node: DOMNativeVNode) => {
    nodes.set(renderContext, node);
    states.set(renderContext.currentState, renderContext);
    if (!renderContext.parent) {
      roots.set(context, renderContext);
      rootRenderContext = renderContext;
      return;
    }
    const { parent } = renderContext;
    const parentChildren = children.get(parent) ?? new Set<RenderContext>();
    children.set(parent, parentChildren);
    parentChildren.add(renderContext);
  };

  contexts.set(root, context);

  let caughtError: unknown = undefined;
  const promises = new Set<Promise<unknown>>();
  let accumulativePromise: Promise<void> | undefined = wait(collector);

  const initialNativeNode = createVNodeFromElement(element);

  if (!rootRenderContext) {
    await Promise.reject(new Error("Expected root render context"));
  }

  const rootQueue: [DOMNativeVNode, RenderContextTree][] = [
    [
      initialNativeNode,
      buildTree(rootRenderContext)
    ]
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

      [rootNativeNode] = rootQueue.shift();

      await hydrate(context, rootNativeNode);

      await options.rendered?.({
        remainingRootsToFlush: rootQueue.length
      });

      tree = buildTree(rootRenderContext);

      if (!anyHooked(tree) || remainingIterations === 0) {
        // const state = { previousState: tree.children[0].context.previousState, currentState: tree.children[0].context.currentState };
        // console.log("None hooked", tree.children[0], state);
        break;
      }

      const { done, value } = await stateChangeIterator.next();

      console.log({ done, value: value.map((value: StateContainer) => value.symbol), context: value.map((value: State) => states.get(value)) });

      if (done) break;

      rootQueue.push([
        rootNativeNode,
        tree
      ]);
    } while (rootQueue.length && !caughtError && (typeof remainingIterations !== "number" || remainingIterations > 0));
  } catch (error) {
    caughtError = caughtError ?? error;
  } finally {
    collector.close();
    await context.close();
    await accumulativePromise;
    await Promise.all(promises);
  }

  if (caughtError) {
    throw caughtError;
  }

  return [rootNativeNode, context];

  function anyHooked(tree: RenderContextTree): boolean {
    return (
      tree.context.dispatcher.hooked ||
      tree.children.findIndex(anyHooked) > -1
    );
  }

  function setQueues(tree: RenderContextTree, queues: Map<RenderContext, DeferredActionIterator>) {
    queues.set(tree.context, tree.context.updateQueueIterator);
    for (const child of tree.children) {
      setQueues(child, queues);
    }
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
      {
        controller: context,
        updateQueue: collector,
        stateChanges,
        contextMap: new Map(),
        errorBoundary: onAnyError
      },
      { reference: Fragment, source: element, options: {} }
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
    collector.add(() => promise);
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
