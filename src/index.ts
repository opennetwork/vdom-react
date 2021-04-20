import { ReactElement } from "react";
import { NativeVNode } from "@opennetwork/vdom";
import { createVNode } from "./node";
import { Fragment, hydrate } from "@opennetwork/vnode";
import { Collector } from "microtask-collector";
import { RenderContext } from "./context";
import { DeferredAction, DeferredActionCollector } from "./queue";
import { State } from "./state";
import { deferred } from "./deferred";

export type {
  NativeVNode,
  RenderContext
};

const contexts = new WeakMap<Element, RenderContext>();

interface SettleFn {
  (fn: () => void): void;
}

interface RenderOptions {
  rendered?(): Promise<void> | void;
  actions?: Collector<DeferredAction>;
  stateChanges?: Collector<[RenderContext, State]>;
  context?: RenderContext;
  onContext?(context: RenderContext): Promise<void> | void;
  maxIterations?: number;
  settleAfterMicrotasks?: number;
  settleAfterMacrotask?: boolean;
  settleAfterTimeout?: number;
  settle?: SettleFn;
  promise?(promise: Promise<unknown>): void;
}

export function render(node: ReactElement, root: Element, options: RenderOptions = {}): unknown {
  return renderAsync(node, root, options);
}

export async function renderAsync(element: ReactElement, root: Element, options: RenderOptions = {}): Promise<[NativeVNode, RenderContext]> {
  const doneDeferred = deferred();

  const settle = getSettle();

  const context = options.context ?? contexts.get(root) ?? new RenderContext({
    contextMap: new Map(),
    errorBoundary: onAnyError,
    promise: knownPromise,
    createVNode,
    root,
    rendered: options.rendered
  });
  contexts.set(root, context);
  if (options.onContext) {
    await options.onContext(context);
  }

  let caughtError: unknown = undefined;
  const promises = new Set<Promise<unknown>>();
  const initialNativeNode = createVNodeFromElement(element);
  try {
    await hydrate(context, initialNativeNode);
  } catch (error) {
    caughtError = caughtError ?? error;
  } finally {
    try {
      while (promises.size && !caughtError) {
        if (settle) {
          const shouldBreak = await Promise.any([
            Promise.any(promises).then(() => false),
            runSettle()
          ]);
          if (shouldBreak) {
            break;
          }
        } else {
          await Promise.any(promises);
        }
      }
      await context.close();
      doneDeferred.resolve();
    } catch (error) {
      caughtError = caughtError ?? error;
    }
  }

  if (caughtError) {
    throw caughtError;
  }

  return [initialNativeNode, context];

  function createVNodeFromElement(element: ReactElement) {
    return createVNode(
      { reference: Fragment, source: element, options: {} },
      context.createChildRenderContextOptions({})
    );
  }

  function onAnyError(error: unknown) {
    caughtError = error;
    return true;
  }

  function knownPromise(promise: Promise<unknown>) {
    if (options.promise) {
      return options.promise(promise);
    }
    promises.add(promise);
    promise.then(onResolve, onError);
    function onError(error: unknown) {
      promises.delete(promise);
      onAnyError(error);
    }
    function onResolve() {
      promises.delete(promise);
    }
  }

  async function runSettle(): Promise<true> {
    await new Promise<void>(settle);
    return true;
  }

  function getSettle(): SettleFn | undefined {
    if (options.settle) {
      return options.settle;
    }
    if (options.settleAfterTimeout ?? options.settleAfterMacrotask) {
      return (fn) => setTimeout(fn, options.settleAfterTimeout ?? 0);
    }
    const initialMicrotasks = options.settleAfterMicrotasks;
    if (initialMicrotasks) {
      return (fn) => {
        let remainingMicrotasks = initialMicrotasks;
        next();
        function next() {
          queueMicrotask(() => {
            remainingMicrotasks -= 1;
            if (remainingMicrotasks > 0) {
              next();
            } else {
              fn();
            }
          });
        }
      };
    }
    return undefined;
  }
}
