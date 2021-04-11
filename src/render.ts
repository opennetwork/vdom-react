import { isSourceReference, isVNode } from "@opennetwork/vnode";
import { Controller, RenderMeta } from "./controller";
import { deferred, Deferred } from "./deferred";
import { isAbortLifecycleError } from "./lifecycle";
import { createVNode as createBasicVNode } from "@opennetwork/vnode";
import { assertReactElement, isReactComponentClass } from "./type-guards";
import { transform } from "./transform";
import { DeferredAction, DeferredActionIterator } from "./queue";
import { isPromise } from "iterable";
import { ComponentInstanceMap, renderComponent } from "./component";
import { renderFunction } from "./function";
import type { Options, createVNode } from "./node";
import type { Dispatcher } from "./dispatcher";
import type { State } from "./state";
import {
  ElementDOMNativeVNode,
  Native,
  isFragmentDOMNativeVNode,
  isElementDOMNativeVNode,
  DOMNativeVNode
} from "@opennetwork/vdom";
import { noop } from "./noop";

export interface RenderContext<P = unknown> {
  readonly options: Options;
  readonly currentState: State;
  previousState: State;
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

  do {
    dispatcher.beforeRender();

    const renderingProps = context.currentProps;
    const renderingState = context.currentState;

    renderMeta = {
      parent,
      onError,
      currentState: renderingState,
      currentProps: context.currentProps,
      previousState: renderedState,
      previousProps: renderedProps
    };

    if (renderedState.symbol !== renderingState.symbol) {
      try {
        if (!(await controller?.beforeRender?.(context, renderMeta) ?? true)) break;
        let renderResult;
        renderDeferred = deferred();
        context.rendering = renderDeferred.promise;
        try {
          renderResult = await render(context);
        } catch (error) {
          if (isAbortLifecycleError(error)) {
            renderResult = undefined;
          } else if (await onError(error)) {
            break;
          }
        } finally {
          renderDeferred.resolve();
          if (renderDeferred.promise === context.rendering) {
            context.rendering = undefined;
          }
        }
        if (!renderResult) {
          renderedState = context.previousState = {
            ...renderingState,
            change: noop
          };
          // This will jump to our update queue
          continue;
        }
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
        // If we use the symbol that was present as render started, it allows for things to happen
        // _while_ we render outside of this cycle
        renderedState = context.previousState = {
          ...renderingState,
          change: noop
        };
        renderedProps = context.previousProps = renderingProps;
      } catch (error) {
        if (await onError(error)) {
          break;
        }
      }
      // This should be only done when we have rendered
      await dispatcher.commitHookEffectList(0);
    }
    willContinue = (await controller?.willContinue?.(context, renderMeta) ?? false);
    if (dispatcher.hooked && (willContinue || parent)) {
      if (!(await waitForUpdates(!willContinue))) {
        break;
      }
    }
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

  async function waitForUpdates(detach: boolean): Promise<boolean> {
    const update = async (): Promise<boolean> => {
      const updateQueueIterationResult = await updateQueueIterator.next();
      const results = await Promise.all<boolean>(
        (updateQueueIterationResult.value ?? []).map(async (fn: DeferredAction): Promise<boolean> => {
          try {
            await fn();
          } catch (error) {
            if (await renderMeta.onError(error)) {
              return false;
            }
          }
        })
      );
      return results.find(value => !value) ?? true;
    };
    const { parent } = renderMeta;
    if (detach) {
      if (parent) {
        parent.dispatcher.updateQueue.add(update);
      } else {
        // Do nothing
        return;
      }
    } else if (context === parent) {
      return await update();
    } else {
      return await new Promise<boolean>(resolve => parent.dispatcher.updateQueue.add(async () => {
        try {
          await update();
        } catch (error) {
          if (await renderMeta.onError(error)) {
            return resolve(false);
          }
        }
        resolve(true);
      }));
    }
  }

  async function onError(error: unknown): Promise<boolean> {
    if (isAbortLifecycleError(error)) {
      return false;
    } else if (isPromise(error)) {
      const promiseError: Promise<unknown> = error;
      // If we are here, and we know this error, it was already thrown and resolved
      // Else we already know about it and it is in our update queue
      if (!knownPromiseErrors.has(error)) {
        dispatcher.updateQueue.add(() => promiseError);
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
