import { RenderOptions as DOMRenderOptions } from "@opennetwork/vdom/dist/context";
import { hydrateChildrenGroup, Tree, VNode } from "@opennetwork/vnode";
import { DOMVContext } from "@opennetwork/vdom";
import { isReactVNode } from "./react";

export interface RenderOptions extends DOMRenderOptions {
  promise(promise: Promise<unknown>, node: VNode, tree?: Tree): void;
}

export class ReactDOMVContext extends DOMVContext {

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
