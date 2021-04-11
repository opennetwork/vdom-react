import { AbortSignal } from "./cancellable";
import type { State } from "./state";
import type { RenderContext } from "./render";

export interface RenderMeta {
  currentState: State;
  currentProps: unknown;
  previousState: State;
  previousProps: unknown;
  onError(error: unknown): Promise<boolean> | boolean;
  parent?: RenderContext;
}

export interface Controller extends AbortSignal {
  hello?(node: RenderContext): void;
  beforeRender?(context: RenderContext, meta: RenderMeta): Promise<boolean>;
  afterRender?(context: RenderContext, meta: RenderMeta): Promise<boolean>;
  beforeDestroyed?(context: RenderContext): Promise<void>;
  afterDestroyed?(context: RenderContext): Promise<void>;
}
