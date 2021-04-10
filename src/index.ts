import { ReactElement } from "react";
import { DOMNativeVNode, DOMVContext, Native, RenderOptions as DOMRenderOptions } from "@opennetwork/vdom";
import { isReactVNode, createVNode } from "./node";
import { createVNode as createBasicVNode, Fragment, hydrate, Tree, VNode } from "@opennetwork/vnode";
import { Collector } from "microtask-collector";
import { hydrateChildrenGroup } from "@opennetwork/vnode";
import { ReactDOMVContext } from "./context";

const contexts = new WeakMap<Element, DOMVContext>();


export function render(node: ReactElement, root: Element): unknown {
  return renderAsync(node, root);
}

export async function renderAsync(node: ReactElement, root: Element): Promise<DOMNativeVNode> {
  if (contexts.get(root)) {
    throw new Error("Double render is not currently supported");
  }
  const collector = new Collector({
    eagerCollection: true
  });
  const context = new ReactDOMVContext({
    root,
    promise
  });
  contexts.set(root, context);

  const promises = new Set<Promise<unknown>>();

  const rootVNode = createVNode({}, { reference: Fragment, source: node, options: {} });
  rootVNode.options.setContinueFlag(() => true);
  const rootNativeNode = Native({}, createBasicVNode(Fragment, {}, rootVNode));
  try {
    await Promise.all([
      hydrate(context, rootNativeNode).then(close, close),
      wait()
    ]);
  } finally {
    await context.close();
    await Promise.all(promises);
  }
  return rootNativeNode;

  async function close() {
    collector.close();
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
