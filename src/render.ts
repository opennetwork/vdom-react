import { isSourceReference, isVNode } from "@opennetwork/vnode";
import { Controller, RenderMeta } from "./controller";
import { deferred, Deferred } from "./deferred";
import { isAbortLifecycleError } from "./lifecycle";
import { createVNode as createBasicVNode } from "@opennetwork/vnode";
import { assertReactElement, isReactComponentClass } from "./type-guards";
import { transform } from "./transform";
import { DeferredActionIterator } from "./queue";
import { isPromise } from "iterable";
import { ComponentInstanceMap, renderComponent } from "./component";
import { renderFunction } from "./function";
import type { Options, createVNode } from "./node";
import type { Dispatcher } from "./dispatcher";
import type { State, StateContainer } from "./state";
import {
  ElementDOMNativeVNode,
  Native,
  isFragmentDOMNativeVNode,
  isElementDOMNativeVNode,
  DOMNativeVNode
} from "@opennetwork/vdom";

export interface RenderContext<P = unknown> {
  readonly options: Options;
  readonly currentState: State;
  previousState: StateContainer;
  previousProps: P;
  currentProps: P;
  readonly dispatcher: Dispatcher;
  parent?: RenderContext;
  controller?: Controller;
  rendering: Promise<void>;
  createVNode: typeof createVNode;
  continueFlag?: () => boolean;
  readonly isDestroyable: boolean;
  readonly destroyed: boolean;
  destroy(): void;
  updateQueueIterator: DeferredActionIterator;
  instance: ComponentInstanceMap<P>;
  source: () => unknown;
}

export async function *renderGenerator<P>(context: RenderContext<P>): AsyncIterable<ElementDOMNativeVNode[]> {
  const {
    dispatcher,
    parent,
    controller,
    destroy,
    updateQueueIterator,
    options
  } = context;

  const knownPromiseErrors = new WeakSet<Promise<unknown>>();
  let renderedState = context.previousState,
    renderedProps = context.previousProps,
    renderMeta: RenderMeta,
    renderDeferred: Deferred,
    willContinue: boolean = true;

  let caughtError: unknown;

  let thrownPromise: boolean;

  do {
    dispatcher.beforeRender();

    thrownPromise = false;

    const renderingProps = context.currentProps;
    const renderingState: StateContainer = {
      symbol: context.currentState.symbol,
      value: context.currentState.value
    };

    renderMeta = {
      parent,
      onError,
      currentState: renderingState,
      currentProps: renderingProps,
      previousState: renderedState,
      previousProps: renderedProps
    };

    console.log(renderMeta, context.source);
    if (renderedState.symbol !== renderingState.symbol) {
      try {
        if (!(await controller?.beforeRender?.(context, renderMeta) ?? true)) break;
        let renderResult;
        renderDeferred = deferred();
        context.rendering = renderDeferred.promise;
        try {
          renderResult = await render(context);
        } catch (error) {
          if (await onError(error)) {
            break;
          }
        } finally {
          renderDeferred.resolve();
          if (renderDeferred.promise === context.rendering) {
            context.rendering = undefined;
          }
        }
        if (renderResult) {
          const [latestValue, childrenOptions] = renderResult;
          if (!dispatcher.hooked) {
            const node = isVNode(latestValue) ? latestValue : isSourceReference(latestValue) ? createBasicVNode(latestValue) : undefined;
            if (node) {
              const native = (isElementDOMNativeVNode(node) || isFragmentDOMNativeVNode(node)) ? node : Native(node.options, node);
              yield *flatten(native);
            } else {
              yield [];
            }
          }
          if (!latestValue) {
            yield [];
          } else {
            assertReactElement(latestValue);
            yield *flatten(transform({
              updateQueue: dispatcher.updateQueue,
              createVNode: context.createVNode,
              options: {
                ...childrenOptions,
                parent: context
              },
              element: latestValue
            }));
          }
        }
        if (!thrownPromise) {
          renderedState = context.previousState = renderingState;
        }
        renderedProps = context.previousProps = renderingProps;
      } catch (error) {
        if (await onError(error)) {
          break;
        }
      }
      await dispatcher.commitHookEffectList(0);
    }
    willContinue = (await controller?.willContinue?.(context, renderMeta) ?? false);
  } while (!context.isDestroyable && willContinue && (await controller?.afterRender?.(context, renderMeta) ?? true) && dispatcher.hooked && controller?.aborted !== true && !caughtError);

  if (caughtError) {
    await destroy();
    await Promise.reject(caughtError);
  }

  async function *flatten(native: DOMNativeVNode): AsyncIterable<ElementDOMNativeVNode[]> {
    if (isFragmentDOMNativeVNode(native)) {
      for await (const elements of native.children) {
        yield elements;
      }
    } else if (isElementDOMNativeVNode(native)) {
      yield [native];
    } else {
      throw new Error("Expected FragmentDOMNativeVNode or isElementDOMNativeVNode");
    }
  }

  async function onError(error: unknown): Promise<boolean> {
    if (isAbortLifecycleError(error)) {
      return false;
    } else if (isPromise(error)) {
      thrownPromise = true;
      const promiseError: Promise<unknown> = error;
      // If we are here, and we know this error, it was already thrown and resolved
      // Else we already know about it and it is in our update queue
      if (!knownPromiseErrors.has(error)) {
        dispatcher.updateQueue.add(async () => {
          await promiseError;
          dispatcher.state.change();
        });
        knownPromiseErrors.add(error);
      }
      return false;
    } else if (await options.errorBoundary(error)) {
      // If the error boundary returned true, the error should be thrown later on
      caughtError = error;
      await updateQueueIterator.return?.();
    }
    return true;
  }
}

export async function render<P>(context: RenderContext<P>): Promise<[unknown, Options]>  {
  const { source, currentProps: props } = context;
  if (isReactComponentClass<P, Record<string, unknown>>(source)) {
    return renderComponent(context, source);
  } else {
    const renderResult = await renderFunction(source, context.dispatcher, props);
    return [renderResult, context.options];
  }
}
