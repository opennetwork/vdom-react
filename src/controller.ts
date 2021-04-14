import type { AbortSignal } from "./cancellable";
import type { StateContainer } from "./state";
import type { RenderContext } from "./render";
import type { DOMNativeVNode } from "@opennetwork/vdom";

export interface RenderMeta {
  currentState: StateContainer;
  currentProps: unknown;
  previousState: StateContainer;
  previousProps: unknown;
  onError(error: unknown): Promise<boolean> | boolean;
  parent?: RenderContext;
}

export interface Controller extends AbortSignal {
  hello?(renderContext: RenderContext, node: DOMNativeVNode): void;
  willContinue?(renderContext: RenderContext, meta: RenderMeta): boolean | Promise<boolean>;
  beforeRender?(renderContext: RenderContext, meta: RenderMeta): boolean | Promise<boolean>;
  afterRender?(renderContext: RenderContext, meta: RenderMeta, willContinue: boolean): boolean | Promise<boolean>;
  beforeDestroyed?(renderContext: RenderContext): void | Promise<void>;
  afterDestroyed?(renderContext: RenderContext): void | Promise<void>;
}
