import type { AbortSignal } from "./cancellable";
import type { State } from "./state";
import type { RenderContext } from "./render";
import type { DOMNativeVNode } from "@opennetwork/vdom";

export interface RenderMeta {
  currentState: State;
  currentProps: unknown;
  previousState: State;
  previousProps: unknown;
  onError(error: unknown): Promise<boolean> | boolean;
  parent?: RenderContext;
}

export interface Controller extends AbortSignal {
  hello?(renderContext: RenderContext, node: DOMNativeVNode): void;
  willContinue?(renderContext: RenderContext, meta: RenderMeta): boolean | Promise<boolean>;
  beforeRender?(renderContext: RenderContext, meta: RenderMeta): boolean | Promise<boolean>;
  afterRender?(renderContext: RenderContext, meta: RenderMeta): boolean | Promise<boolean>;
  beforeDestroyed?(renderContext: RenderContext): void | Promise<void>;
  afterDestroyed?(renderContext: RenderContext): void | Promise<void>;
}
