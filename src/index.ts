import { ReactElement } from "react";
import { DOMNativeVNode, DOMVContext } from "@opennetwork/vdom";
import { createVNode } from "./node";
import { Fragment, hydrate, Tree } from "@opennetwork/vnode";
import { Collector } from "microtask-collector";
import { ReactDOMVContext } from "./context";
import { RenderContext } from "./render";

export type {
  DOMNativeVNode,
  ReactDOMVContext
};

const contexts = new WeakMap<Element, DOMVContext>();
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
  const context = new ReactDOMVContext({
    root,
    promise
  });
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

  const node = createVNodeFromElement(element);

  if (!rootRenderContext) {
    await Promise.reject(new Error("Expected root render context"));
  }

  let rootQueue: [DOMNativeVNode, RenderContextTree][] = [
    [
      node,
      buildTree(rootRenderContext)
    ]
  ];

  let rootNativeNode: DOMNativeVNode | undefined;
  let tree: RenderContextTree | undefined;
  try {
    // Hydrate at least once no matter what
    do {
      [rootNativeNode, tree] = await getNextRoot();
      if (!rootNativeNode) {
        break;
      }

      await hydrate(context, rootNativeNode, tree);

      await options.rendered?.({
        remainingRootsToFlush: rootQueue.length
      });

      if (rootQueue.length) {
        continue; // Allow the current queue to flush
      }

      tree = buildTree(rootRenderContext);

      await waitForTreeChange(tree);

      const changes = getChanges(tree);

      if (!changes.length) {
        await Promise.reject(new Error("Expected at least one change since waitForTreeChange, rollback isn't yet implemented?"));
      }

      rootQueue = changes.map((tree): [DOMNativeVNode, RenderContextTree] => [nodes.get(tree.context), tree]).filter(Boolean);
    } while (!isComplete(tree));
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

  function getChanges(tree: RenderContextTree): RenderContextTree[] {
    const { context } = tree;
    if (context.currentState.symbol !== context.previousState.symbol) {
      return [tree];
    } else {
      return tree.childrenTrees.reduce<RenderContextTree[]>(
        (changes, tree) => changes.concat(getChanges(tree)),
        []
      );
    }
  }

  function waitForTreeChange(tree: RenderContextTree): Promise<void> {
    return Promise.any([
      tree.context.dispatcher.state.promise,
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

  async function getNextRoot(): Promise<[DOMNativeVNode, RenderContextTree] | undefined> {
    return rootQueue.shift();
  }

  function createVNodeFromElement(element: ReactElement) {
    return createVNode({ controller: context }, { reference: Fragment, source: element, options: {} });
  }

  function isComplete(tree: RenderContextTree) {
    // By default in prod we will only rely on isDestroyable
    return tree.context.isDestroyable || true;
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
