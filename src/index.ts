import { ReactElement } from "react";
import { DOMNativeVNode, DOMVContext } from "@opennetwork/vdom";
import { createVNode } from "./node";
import { Fragment, hydrate, Tree } from "@opennetwork/vnode";
import { Collector } from "microtask-collector";
import { ReactDOMVContext } from "./context";
import { RenderContext } from "./render";
import { DeferredAction, DeferredActionCollector, DeferredActionIterator, DeferredActionIteratorResult } from "./queue";
import { noop } from "./noop";

export type {
  DOMNativeVNode,
  ReactDOMVContext
};

const contexts = new WeakMap<Element, ReactDOMVContext>();
const roots = new WeakMap<DOMVContext, RenderContext>();
const children = new WeakMap<RenderContext, Set<RenderContext>>();
const nodes = new WeakMap<RenderContext, DOMNativeVNode>();

interface RenderContextTree extends Tree {
  context: RenderContext;
  childrenTrees: RenderContextTree[];
}

interface RenderDetails {
  remainingRootsToFlush?: number;
}

interface RenderOptions {
  rendered?(details: RenderDetails): Promise<void>;
}

export function render(node: ReactElement, root: Element, options: RenderOptions = {}): unknown {
  return renderAsync(node, root, options);
}

export async function renderAsync(element: ReactElement, root: Element, options: RenderOptions = {}): Promise<[DOMNativeVNode, ReactDOMVContext]> {
  const collector = new Collector({
    eagerCollection: true
  });
  const context = contexts.get(root) ?? new ReactDOMVContext({
    root,
    promise
  });
  contexts.set(root, context);
  let rootRenderContext = roots.get(context);

  // We will operate on the assumptions that all nodes right now should just process one render
  // for a cycle, we can change this in the future for root nodes of active elements, but that's
  // not a concern for now
  context.willContinue = () => false;

  context.hello = (renderContext: RenderContext, node: DOMNativeVNode) => {
    nodes.set(renderContext, node);
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

  const promises = new Set<Promise<unknown>>();
  const accumulativePromise = wait();

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
  const knownQueues = new Map<RenderContext, DeferredActionIterator>();
  const queuePromises = new WeakMap<DeferredActionIterator, Promise<[RenderContext, DeferredActionIterator, DeferredActionIteratorResult]>>();
  let processQueuesPromise: Promise<void> | undefined = undefined;

  try {
    // Hydrate at least once no matter what
    do {
      [rootNativeNode] = rootQueue.shift();

      await hydrate(context, rootNativeNode);

      await options.rendered?.({
        remainingRootsToFlush: rootQueue.length
      });

      tree = buildTree(rootRenderContext);

      if (!anyHooked(tree)) {
        break;
      }

      setQueues(tree, knownQueues);

      if (knownQueues.size && !processQueuesPromise) {
        promise(processQueuesPromise = processQueues());
      }


      const nextTree = await waitForTreeChange(tree);

      rootQueue.push([
        nodes.get(nextTree.context),
        nextTree
      ]);
    } while (rootQueue.length);
  } catch (error) {
    console.error(error);
    throw error;
  } finally {
    collector.close();
    await context.close();
    await accumulativePromise;
    await Promise.all(promises);
  }

  return [rootNativeNode, context];

  function anyHooked(tree: RenderContextTree): boolean {
    return (
      tree.context.dispatcher.hooked ||
      tree.childrenTrees.findIndex(anyHooked) > -1
    );
  }

  function getChanges(tree: RenderContextTree): RenderContextTree[] {
    const { context } = tree;
    if (context.currentState.symbol !== context.previousState.symbol) {
      return [tree];
    } else {
      return tree.childrenTrees.reduce<RenderContextTree[]>(
        (changes, child) => changes.concat(getChanges(child)),
        []
      );
    }
  }

  function setQueues(tree: RenderContextTree, queues: Map<RenderContext, DeferredActionIterator>) {
    queues.set(tree.context, tree.context.updateQueueIterator);
    for (const child of tree.childrenTrees) {
      setQueues(child, queues);
    }
  }

  async function processQueues() {
    try {
      do {
        const [context, iterator, result] = await Promise.any(
          [...knownQueues.entries()]
            .map(async ([context, iterator]): Promise<[RenderContext, DeferredActionIterator, DeferredActionIteratorResult]> => {
              const current = queuePromises.get(iterator);
              if (current) {
                return current;
              }
              const promise = iterator.next()
                .then((result): [RenderContext, DeferredActionIterator, DeferredActionIteratorResult] => [
                  context,
                  iterator,
                  result
                ]);
              promise.catch(noop);
              queuePromises.set(
                iterator,
                promise
              );
              return promise;
            })
        );
        queuePromises.delete(iterator);
        if (result.done) {
          knownQueues.delete(context);
        } else if (isDeferredActionArray(result)) {
          promise(
            Promise.all(
              result.value.map(async (action) => {
                await action();
              })
            )
          );
        }
      } while (knownQueues.size);
    } finally {
      processQueuesPromise = undefined;
    }

    function isDeferredActionArray(result: DeferredActionIteratorResult): result is { value: DeferredAction[] } {
      return Array.isArray(result.value);
    }
  }

  function waitForTreeChange(tree: RenderContextTree): Promise<RenderContextTree> {
    return Promise.any<RenderContextTree>([
      tree.context.dispatcher.state.promise.then(() => tree),
      ...tree.childrenTrees.map(waitForTreeChange)
    ]);
  }

  function buildTree(context: RenderContext): RenderContextTree {
    const childrenArray = [...(children.get(context) ?? [])];
    return {
      context,
      reference: reference(context),
      children: Object.freeze(childrenArray.map(reference)),
      childrenTrees: childrenArray.map(buildTree)
    };

    function reference(context: RenderContext) {
      return nodes.get(context)?.reference ?? Symbol("Unknown context node");
    }
  }

  function createVNodeFromElement(element: ReactElement) {
    return createVNode({ controller: context }, { reference: Fragment, source: element, options: {} });
  }

  async function wait() {
    for await (const promises of collector) {
      await Promise.all(promises);
    }
  }

  function promise(promise: Promise<unknown>) {
    collector.add(promise);
    promises.add(promise);
    promise.then(remove, remove);
    function remove() {
      promises.delete(promise);
    }
  }
}
