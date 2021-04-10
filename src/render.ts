import { ReactElement } from "react";
import { DOMVContext, Native, RenderOptions as DOMRenderOptions } from "@opennetwork/vdom";
import { isReactVNode, createVNode } from "./node";
import { createVNode as createBasicVNode, Fragment, hydrate, Tree, VNode } from "@opennetwork/vnode";
import { Collector } from "microtask-collector";
import { hydrateChildrenGroup } from "@opennetwork/vnode";

const contexts = new WeakMap<Element, DOMVContext>();

interface RenderOptions extends DOMRenderOptions {
  promise(promise: Promise<unknown>, node: VNode, tree?: Tree): void;
}

class ReactDOMVContext extends DOMVContext {

  readonly #promise;

  constructor(options: RenderOptions) {
    super(options);
    this.#promise = options.promise;
  }

  async commitChildren(documentNode: Element, node: VNode, tree?: Tree): Promise<void> {
    const context = this.childContext(documentNode);

    if (isReactVNode(node)) {
      const continueFlag = () => {
        return false;
      };
      node.options.setContinueFlag(continueFlag);
    }

    for await (const children of node.children) {
      await hydrateChildrenGroup(context, node, tree, children);
    }
  }

}

export function render(node: ReactElement, root: Element): unknown {
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
  return Promise.all([
    hydrate(context, rootNativeNode).then(close, close),
    wait()
  ])
    .then(() => Promise.all(promises))
    .then(() => context.close())
    .catch(error => {
      // Intentional catch + throw
      throw error;
    });

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
