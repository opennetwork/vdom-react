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
  rendered?(details: unknown): Promise<void> | void;
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
  let done = false;

  const settle = getSettle();
  const actions = options.actions ?? new Collector<DeferredAction>({
    eagerCollection: true
  });
  const stateChanges = options.stateChanges ?? new Collector<[RenderContext, State]>({
    eagerCollection: true
  });
  const stateChangeIterator = stateChanges[Symbol.asyncIterator]();

  const context = options.context ?? contexts.get(root) ?? new RenderContext({
    actions,
    stateChanges,
    contextMap: new Map(),
    errorBoundary: onAnyError,
    promise: knownPromise,
    createVNode,
    root
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
    console.log({ caughtError });
  } finally {
    console.log("finally");
    try {
      while (promises.size) {
        console.log("promises");
        if (settle) {
          const shouldBreak = await Promise.any([
            Promise.all(promises).then(() => false),
            runSettle()
          ]);
          if (shouldBreak) {
            break;
          }
        } else {
          await Promise.all(promises);
        }
      }
      console.log("context.close");
      await context.close();
      done = true;
      doneDeferred.resolve();
    } catch (e) {
      console.error(e);
    }
  }

  console.log("finished");

  if (caughtError) {
    console.log({ caughtError });
    throw caughtError;
  }

  return [initialNativeNode, context];

  function getNodes(contexts: RenderContext[]) {
    return contexts.flatMap(
      (renderContext: RenderContext) =>
        renderContext.nodes
          .map((node): [RenderContext, NativeVNode] => [renderContext, node])
    );
  }

  function createVNodeFromElement(element: ReactElement) {
    return createVNode(
      { reference: Fragment, source: element, options: {} },
      context.createChildRenderContextOptions({})
    );
  }

  function hasChanged(context: RenderContext): boolean {
    if (context.source && context.previousState.symbol !== context.currentState.symbol) {
      return true;
    }
    return [...context.contexts].some(hasChanged);
  }

  // function getChanged(context: RenderContext): RenderContext[] {
  //   if (context.source && context.previousState.symbol !== context.currentState.symbol) {
  //     return [context];
  //   }
  //   return [...context.contexts].flatMap(getChanged);
  // }

  async function wait(queue: DeferredActionCollector, iterator = queue[Symbol.asyncIterator]()) {
    // let result: DeferredActionIteratorResult;
    // try {
    //   do {
    //     result = await Promise.any<DeferredActionIteratorResult>([
    //       iterator.next(),
    //       doneDeferred.promise.then((): DeferredActionIteratorResult => ({ done: true, value: undefined }))
    //     ]);
    //     if (!result.done && Array.isArray(result.value)) {
    //       result.value.forEach(onDeferredAction);
    //     }
    //   } while (!result.done && !caughtError && !done);
    // } catch (error) {
    //   caughtError = caughtError ?? error;
    // } finally {
    //   accumulativePromise = undefined;
    // }
    //
    // if (result.done && !done) {
    //   const nextIterator = queue[Symbol.asyncIterator]();
    //   knownPromise((async () => {
    //     await new Promise<void>(actions.queueMicrotask);
    //     await wait(queue, nextIterator);
    //   })());
    // }
  }

  function onDeferredAction(action: DeferredAction) {
    knownPromise(runDeferredAction());

    async function runDeferredAction() {
      if (typeof action === "function") {
        await action();
      }
    }
  }

  function unknownPromise(promise: Promise<unknown>) {
    promise.catch(onAnyError);
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
