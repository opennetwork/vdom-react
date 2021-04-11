import { ReactElement } from "react";
import { DOMNativeVNode, DOMVContext, Native } from "@opennetwork/vdom";
import { createVNode } from "./node";
import { createVNode as createBasicVNode, Fragment, hydrate } from "@opennetwork/vnode";
import { Collector } from "microtask-collector";
import { ReactDOMVContext } from "./context";

export type {
  DOMNativeVNode,
  ReactDOMVContext
};

const contexts = new WeakMap<Element, DOMVContext>();

export function render(node: ReactElement, root: Element): unknown {
  return renderAsync(node, root);
}

export async function renderAsync(node: ReactElement, root: Element): Promise<[DOMNativeVNode, ReactDOMVContext]> {
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

  const rootNativeNode = createVNode({}, { reference: Fragment, source: node, options: {} });
  try {
    await Promise.all([
      hydrate(context, rootNativeNode),
      wait()
    ]);
  } finally {
    await context.close();
    await Promise.all(promises);
  }
  return [rootNativeNode, context];

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
