import { isSourceReference, isVNode } from "@opennetwork/vnode";
import { RenderMeta } from "./controller";
import { deferred, Deferred } from "./deferred";
import { isAbortLifecycleError } from "./lifecycle";
import { createVNode as createBasicVNode } from "@opennetwork/vnode";
import { assertReactElement, isReactComponentClass } from "./type-guards";
import { transform } from "./transform";
import { isPromise } from "iterable";
import { renderComponent } from "./component";
import { renderFunction } from "./function";
import type { NeverEndingPromise, StateContainer } from "./state";
import {
  Native,
  isFragmentDOMNativeVNode,
  isDOMNativeVNode,
  NativeVNode,
  DOMNativeVNode
} from "@opennetwork/vdom";
import { RenderContext, RenderContextOptions } from "./context";
import { LifecycleCallbackFns } from "./lifecycle";

export async function *renderGenerator<P>(context: RenderContext<P>): AsyncIterable<DOMNativeVNode[]> {
  const {
    dispatcher,
    parent,
    controller,
    options
  } = context;

  const knownPromiseErrors = new WeakSet<Promise<unknown>>();
  let renderedState = context.previousState,
    renderedProps = context.previousProps,
    renderMeta: RenderMeta,
    renderDeferred: Deferred,
    willContinue: boolean = true,
    stateChangePromise: NeverEndingPromise = renderedState.promise;

  let caughtError: unknown;

  let thrownPromise: boolean;

  do {
    let callbacks: LifecycleCallbackFns | undefined = undefined;

    dispatcher.beforeRender();

    thrownPromise = false;

    const renderingProps = context.currentProps;
    const renderingState: StateContainer = context.currentState.container;

    renderMeta = {
      parent,
      onError,
      currentState: renderingState,
      currentProps: renderingProps,
      previousState: renderedState,
      previousProps: renderedProps
    };

    if (renderedState.symbol !== renderingState.symbol || !context.yielded) {
      try {
        if (!(await controller?.beforeRender?.(context, renderMeta) ?? true)) break;
        let renderResult;
        renderDeferred = deferred();
        context.rendering = renderDeferred.promise;
        try {
          const inProgressCallbacks: LifecycleCallbackFns = {};
          renderResult = await render(context, inProgressCallbacks);
          callbacks = inProgressCallbacks;
        } catch (error) {
          // console.log({ theErrorHere: error, source: context.source.name });
          if (await onError(error)) {
            break;
          }
        } finally {
          renderDeferred.resolve();
          if (renderDeferred.promise === context.rendering) {
            context.rendering = undefined;
          }
        }
        // console.log({ renderResult, yielded: context.yielded, thrownPromise });
        if (renderResult) {
          const [latestValue, childrenOptions] = renderResult;
          if (!dispatcher.hooked) {
            const node = isVNode(latestValue) ? latestValue : isSourceReference(latestValue) ? createBasicVNode(latestValue) : undefined;
            if (node) {
              const native = (isDOMNativeVNode(node) || isFragmentDOMNativeVNode(node)) ? node : Native(node.options, node);
              yield *flatten(native);
            } else {
              yield [];
            }
          }
          if (!latestValue) {
            yield [];
          } else {
            assertReactElement(latestValue);

            for (const counter of context.functionComponentInstanceIndex.values()) {
              counter.reset();
            }

            yield *flatten(transform({
              actions: dispatcher.actions,
              createVNode: context.createVNode,
              options: context.createChildRenderContextOptions(childrenOptions),
              element: latestValue,
              getInstance: context.getInstance.bind(context)
            }));

            for (const [source, counter] of context.functionComponentInstanceIndex.entries()) {
              const { index } = counter;
              if (index > -1) {
                continue;
              }
              context.functionComponentInstances.delete(source);
              context.functionComponentInstanceIndex.delete(source);
            }
          }
        }
        renderedState = context.previousState = renderingState;
        renderedProps = context.previousProps = renderingProps;
      } catch (error) {
        if (await onError(error)) {
          break;
        }
      }
      await dispatcher.commitHookEffectList(0);
      await callbacks?.onAfterRender?.();
    }

    willContinue = (await controller?.willContinue?.(context, renderMeta) ?? false) && willContinueScope();
    willContinue = (await controller?.afterRender?.(context, renderMeta, willContinue) ?? true) && willContinue;

    if (willContinue) {
      const next = await context.actionsIterator.next();
      if (next.done) {
        await context.actionsIterator.return?.();
        context.actionsIterator = undefined;
      } else if (next.value) {
        for (const action of next.value) {
          try {
            await action();
          } catch (error) {
            if (await onError(error)) {
              willContinue = false;
              break;
            }
          }
        }
      }
      [stateChangePromise] = await stateChangePromise;
    }
  } while (willContinue && willContinueScope());


  if (caughtError) {
    await context.close();
    await Promise.reject(caughtError);
  }

  function willContinueScope(): boolean {
    return !context.isDestroyable && dispatcher.hooked && controller?.aborted !== true && !caughtError;
  }

  async function *flatten(native: NativeVNode): AsyncIterable<DOMNativeVNode[]> {
    if (isFragmentDOMNativeVNode(native)) {
      for await (const elements of native.children) {
        yield elements;
      }
    } else if (isDOMNativeVNode(native)) {
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
        dispatcher.actions.add(async () => {
          await promiseError;
          dispatcher.state.change();
        });
        knownPromiseErrors.add(error);
      }
      return false;
    } else if (await options.errorBoundary(error)) {
      // If the error boundary returned true, the error should be thrown later on
      caughtError = error;
      await context.actionsIterator.return?.();
      context.actionsIterator = undefined;
    }
    return true;
  }
}

export async function render<P>(context: RenderContext<P>, callbacks: LifecycleCallbackFns): Promise<[unknown, RenderContextOptions]>  {
  const { source, currentProps: props } = context;
  if (isReactComponentClass<P, Record<string, unknown>>(source)) {
    return renderComponent(context, source, callbacks);
  } else {
    const renderResult = await renderFunction(source, context.dispatcher, props);
    return [renderResult, context.options];
  }
}
