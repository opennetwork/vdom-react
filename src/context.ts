import { RenderOptions as DOMRenderOptions } from "@opennetwork/vdom/dist/context";
import { Tree, VNode } from "@opennetwork/vnode";
import { DOMVContext } from "@opennetwork/vdom";
import { SimpleSignal } from "./cancellable";
import { Controller } from "./controller";

export interface RenderOptions extends DOMRenderOptions {
  promise(promise: Promise<unknown>, node: VNode, tree?: Tree): void;
}

export class ReactDOMVContext extends DOMVContext implements Controller {

  readonly #signal = new SimpleSignal();
  readonly #promise;

  get aborted() {
    return this.#signal.aborted;
  }

  constructor(options: RenderOptions) {
    super(options);
    this.#promise = options.promise;
  }

  hydrate(node: VNode, tree?: Tree): Promise<void> {



    return super.hydrate(node, tree);
  }

}
