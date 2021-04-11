import { RenderOptions as DOMRenderOptions } from "@opennetwork/vdom/dist/context";
import { Tree, VNode } from "@opennetwork/vnode";
import { DOMNativeVNode, DOMVContext } from "@opennetwork/vdom";
import { SimpleSignal } from "./cancellable";
import { Controller, RenderMeta } from "./controller";
import { RenderContext } from "./render";

export interface RenderOptions extends DOMRenderOptions {
  promise(promise: Promise<unknown>, node: VNode, tree?: Tree): void;
}

export class ReactDOMVContext extends DOMVContext implements Controller {

  readonly #signal = new SimpleSignal();
  readonly #promise;

  get aborted() {
    return this.#signal.aborted;
  }

  hello?(renderContext: RenderContext, node: DOMNativeVNode): void;
  willContinue?(renderContext: RenderContext, meta: RenderMeta): boolean | Promise<boolean>;
  beforeRender?(renderContext: RenderContext, meta: RenderMeta): boolean | Promise<boolean>;
  afterRender?(renderContext: RenderContext, meta: RenderMeta): boolean | Promise<boolean>;
  beforeDestroyed?(renderContext: RenderContext): void | Promise<void>;
  afterDestroyed?(renderContext: RenderContext): void | Promise<void>;

  constructor(options: RenderOptions) {
    super(options);
    this.#promise = options.promise;
  }

  hydrate(node: VNode, tree?: Tree): Promise<void> {
    return super.hydrate(node, tree);
  }

}
