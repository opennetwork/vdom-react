import { isSourceReference, isVNode, VNode } from "@opennetwork/vnode";
import { Controller, RenderMeta } from "./controller";
import { deferred, Deferred } from "./deferred";
import { isAbortLifecycleError } from "./lifecycle";
import { createVNode as createBasicVNode } from "@opennetwork/vnode";
import { assertReactElement, isReactComponent } from "./type-guards";
import { transform } from "./transform";
import { DeferredAction, DeferredActionIterator } from "./queue";
import { isPromise } from "iterable";
import { ComponentInstanceMap, renderComponent } from "./component";
import { renderFunction } from "./function";
import type { ReactOptions, ReactVNode, createVNode, ContextSymbol, ParentSymbol, ErrorBoundarySymbol } from "./node";
import type { Dispatcher } from "./dispatcher";
import type { State } from "./state";
import { DOMNativeVNode, Native } from "@opennetwork/vdom";

export interface RenderContext<P> {
  readonly currentState: State;
  previousState: State;
  previousProps: P;
  currentProps: P;
  readonly dispatcher: Dispatcher;
  parent?: ReactVNode;
  controller?: Controller;
  node: ReactVNode;
  rendering: Promise<void>;
  createVNode: typeof createVNode;
  contextSymbol: ContextSymbol;
  parentSymbol: ParentSymbol;
  errorBoundarySymbol: ErrorBoundarySymbol;
  continueFlag?: () => boolean;
  readonly isDestroyable: boolean;
  destroy(): void;
  updateQueueIterator: DeferredActionIterator;
  instance: ComponentInstanceMap<P>;
}

export async function *renderGenerator<P>(context: RenderContext<P>, options: ReactOptions, source: () => unknown): AsyncIterable<ReadonlyArray<DOMNativeVNode>> {
  const {
    dispatcher,
    parent,
    controller,
    node,
    destroy,
    updateQueueIterator
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
    const renderingState = dispatcher.state;

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
        if (!await controller?.beforeRender?.(node, renderMeta)) break;
        let renderResult;
        renderDeferred = deferred();
        context.rendering = renderDeferred.promise;
        try {
          renderResult = await render(context, options, source, renderingProps);
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
          renderedState = context.previousState = renderingState;
          // This will jump to our update queue
          continue;
        }
        const [latestValue, childrenOptions] = renderResult;
        if (!dispatcher.hooked) {
          const node = isVNode(latestValue) ? latestValue : isSourceReference(latestValue) ? createBasicVNode(latestValue) : undefined;
          if (node) {
            yield Object.freeze([Native(node.options, node)]);
          } else {
            yield Object.freeze([]);
          }
        }
        if (!latestValue) {
          yield Object.freeze([]);
        } else {
          assertReactElement(latestValue);
          yield Object.freeze(
            [
              transform({
                updateQueue: dispatcher.updateQueue,
                createVNode: context.createVNode,
                contextSymbol: context.contextSymbol,
                options: {
                  ...childrenOptions,
                  [context.parentSymbol]: node
                },
                element: latestValue
              })
            ]
          );
        }
        // If we use the symbol that was present as render started, it allows for things to happen
        // _while_ we render outside of this cycle
        renderedState = context.previousState = renderingState;
        renderedProps = context.previousProps = renderingProps;
      } catch (error) {
        if (await onError(error)) {
          break;
        }
      }
      // This should be only done when we have rendered
      await dispatcher.commitHookEffectList(0);
    }
    willContinue = (context.continueFlag?.() ?? true);
    if (dispatcher.hooked && (willContinue || parent)) {
      if (!(await waitForUpdates(!willContinue))) {
        break;
      }
    }
  } while (!context.isDestroyable && willContinue && (await controller.afterRender?.(node, renderMeta) ?? true) && dispatcher.hooked && controller?.aborted !== true && !caughtError);

  if (caughtError) {
    await destroy();
    await Promise.reject(caughtError);
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
        parent.options.updateQueue.add(update);
      } else {
        // Do nothing
        return;
      }
    } else if (node === parent) {
      return await update();
    } else {
      return await new Promise<boolean>(resolve => parent.options.updateQueue.add(async () => {
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
    } else if (await options[context.errorBoundarySymbol](error)) {
      // If the error boundary returned true, the error should be thrown later on
      caughtError = error;
      await updateQueueIterator.return?.();
    }
    return true;
  }
}

export async function render<P>(context: RenderContext<P>, options: ReactOptions, source: () => unknown, props: P): Promise<[unknown, ReactOptions]>  {
  if (isReactComponent<P, Record<string, unknown>>(source)) {
    return renderComponent({
      ...context,
      options,
      source,
      props,
    });
  } else {
    const renderResult = await renderFunction(source, context.dispatcher, props);
    return [renderResult, options];
  }
}
