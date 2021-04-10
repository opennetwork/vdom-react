import { RenderOptions as DOMRenderOptions } from "@opennetwork/vdom/dist/context";
import { hydrateChildrenGroup, Tree, VNode } from "@opennetwork/vnode";
import { DOMVContext } from "@opennetwork/vdom";
import { isReactVNode } from "./node";

export interface RenderOptions extends DOMRenderOptions {
  promise(promise: Promise<unknown>, node: VNode, tree?: Tree): void;
}

export class ReactDOMVContext extends DOMVContext {

  readonly #promise;

  constructor(options: RenderOptions) {
    super(options);
    this.#promise = options.promise;
  }

  hydrate(node: VNode, tree?: Tree): Promise<void> {



    return super.hydrate(node, tree);
  }

}
