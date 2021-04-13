import {
  Context as ReactContext,
  Dispatch,
  DispatchWithoutAction,
  EffectCallback,
  MutableRefObject,
  Reducer,
  ReducerAction,
  ReducerState,
  ReducerStateWithoutAction,
  ReducerWithoutAction,
  RefObject,
  SetStateAction
} from "react";
import { createWorkInProgressContext, useWorkInProgress, WorkInProgressContext } from "./work-in-progress";
import type {
  Destructor,
  FunctionComponentUpdateQueue, ReactDispatcher,
  WorkInProgressHook,
  WorkInProgressHookEffect,
  WorkInProgressHookQueue
} from "react-reconciler";
import { DeferredActionCollector } from "./queue";
import { isReactContext, isSetStateFn } from "./type-guards";
import { noop } from "./noop";
import { Collector } from "microtask-collector";
import { createState, State } from "./state";

export interface ReactContextDescriptor<T = unknown> {
  currentValue: T;
}

export interface DispatcherContext {
  readonly updateQueue?: DeferredActionCollector;
  readonly contextMap?: Map<unknown, ReactContextDescriptor>;
  readonly stateChanges: Collector<State>;
}

export interface Dispatcher extends ReactDispatcher, WorkInProgressContext, DispatcherContext {
  readonly state: State;
  readonly updateQueue: DeferredActionCollector;
  componentUpdateQueue?: FunctionComponentUpdateQueue;
  commitHookEffectList(tag: number): Promise<void>;
  destroyHookEffectList(tag: number): Promise<void>;
  beforeRender(): void;
}

export function createReactDispatcher(context: DispatcherContext) {
  let componentUpdateQueue: FunctionComponentUpdateQueue | undefined = undefined;
  const state = createState<void>(undefined, context.stateChanges);
  const dispatcher: Dispatcher = {
    ...createWorkInProgressContext(),
    ...context,
    updateQueue: context.updateQueue ?? new Collector({
      eagerCollection: true
    }),
    get state() {
      return state;
    },
    get componentUpdateQueue() {
      return componentUpdateQueue;
    },
    set componentUpdateQueue(value) {
      componentUpdateQueue = value;
    },
    beforeRender,
    destroyHookEffectList,
    commitHookEffectList,
    useContext,
    useCallback,
    useMemo,
    useState,
    useReducer,
    useRef,
    useEffect,
    useDebugValue: noop,
    useImperativeHandle: noop,
    useLayoutEffect: noop
  };

  return dispatcher;

  function beforeRender() {
    dispatcher.hookIndex = -1;
    dispatcher.hooked = false;
    dispatcher.componentUpdateQueue = undefined;
  }

  function useContext<T>(context: ReactContext<T>): T {
    return readContext(context);

    function readContext(context: unknown): T {
      assertReactContext(context);
      const found = dispatcher.contextMap?.get(context);
      if (!isReactContextDescriptor(found)) {
        return undefined;
      }
      return found.currentValue;

      function isReactContextDescriptor(value: unknown): value is ReactContextDescriptor<T> {
        return !!value && value === found;
      }

      function assertReactContext(value: unknown): asserts value is ReactContext<unknown> {
        if (!isReactContext(value)) {
          throw new Error("Expected React Context");
        }
      }
    }
  }

  function useMemo<T>(nextCreate: () => T, deps?: unknown[]): T {
    const hook = useWorkInProgress<[T, unknown[]]>(dispatcher);
    if (hook.memoizedState && deps && areHookInputsEqual(deps, hook.memoizedState[1])) {
      return hook.memoizedState[0];
    }
    const next = nextCreate();
    hook.memoizedState = [
      next,
      deps
    ];
    return next;
  }

  function useRef<T>(initialValue: T): MutableRefObject<T>;
  function useRef<T>(initialValue: T|null): RefObject<T>;
  function useRef<T = undefined>(): MutableRefObject<T | undefined>;
  function useRef<T>(initial?: T): MutableRefObject<T> {
    const hook = useWorkInProgress<MutableRefObject<T>>(dispatcher);
    if (!hook.memoizedState) {
      hook.memoizedState = {
        current: initial
      };
    }
    return hook.memoizedState;
  }

  function useCallback<T extends (...args: unknown[]) => unknown>(nextCallback: T, deps?: unknown[]): T {
    const hook = useWorkInProgress<[T, unknown[]]>(dispatcher);
    if (hook.memoizedState && deps && areHookInputsEqual(deps, hook.memoizedState[1])) {
      return hook.memoizedState[0];
    }
    hook.memoizedState = [
      nextCallback,
      deps
    ];
    return nextCallback;
  }

  function useEffect(create: EffectCallback, deps?: unknown[]): void {
    const hook = useWorkInProgress<WorkInProgressHookEffect>(dispatcher);
    if (hook.memoizedState && deps && areHookInputsEqual(deps, hook.memoizedState.deps)) {
      return;
    }
    hook.memoizedState = pushEffect(0, create, hook.memoizedState?.destroy, deps);
  }

  function useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  function useState<S>(initialState?: (() => S) | S): [S, Dispatch<SetStateAction<S>>] {
    const hook = useWorkInProgress<S, WorkInProgressHookQueue<S, SetStateAction<S>>>(dispatcher);
    if (!hook.queue) {
      const state = hook.baseState = hook.memoizedState = isStateFn(initialState) ? initialState() : initialState;
      hook.queue = {
        lanes: 0,
        lastRenderedReducer: basicStateReducer,
        lastRenderedState: state,
      };
      hook.queue.dispatch = dispatchAction.bind(undefined, hook);
    }
    return [hook.memoizedState, hook.queue.dispatch];

    function isStateFn<S>(initialState: (() => S) | S): initialState is (() => S) {
      return typeof initialState === "function";
    }
  }

  function useReducer<R extends ReducerWithoutAction<unknown>, I>(
    reducer: R,
    initializerArg: I,
    initializer: (arg: I) => ReducerStateWithoutAction<R>
  ): [ReducerStateWithoutAction<R>, DispatchWithoutAction];
  function useReducer<R extends ReducerWithoutAction<unknown>>(
    reducer: R,
    initializerArg: ReducerStateWithoutAction<R>,
    initializer?: undefined
  ): [ReducerStateWithoutAction<R>, DispatchWithoutAction];
  function useReducer<R extends Reducer<unknown, unknown>, I>(
    reducer: R,
    initializerArg: I & ReducerState<R>,
    initializer: (arg: I & ReducerState<R>) => ReducerState<R>
  ): [ReducerState<R>, Dispatch<ReducerAction<R>>];
  function useReducer<R extends Reducer<unknown, unknown>, I>(
    reducer: R,
    initializerArg: I,
    initializer: (arg: I) => ReducerState<R>
  ): [ReducerState<R>, Dispatch<ReducerAction<R>>];
  function useReducer<R extends Reducer<unknown, unknown>>(
    reducer: R,
    initialState: ReducerState<R>,
    initializer?: undefined
  ): [ReducerState<R>, Dispatch<ReducerAction<R>>];
  function useReducer<R extends Reducer<unknown, unknown>, I = undefined>(
    reducer: unknown,
    initialStateOrArg: unknown,
    initializer: unknown
  ): [ReducerState<R>, Dispatch<ReducerAction<R>>] {
    type S = ReducerState<R>;
    type A = ReducerAction<R>;
    assertReducer(reducer);
    const hook = useWorkInProgress<S, WorkInProgressHookQueue<S, A>>(dispatcher);
    if (!hook.queue) {
      const initialState = getInitialState();
      hook.queue = {
        lanes: 0,
        lastRenderedReducer: reducer,
        lastRenderedState: initialState
      };
      hook.queue.dispatch = dispatchAction.bind(undefined, hook);
      hook.memoizedState = initialState;
    }
    return [hook.memoizedState, hook.queue.dispatch];

    function assertReducer(value: unknown): asserts value is Reducer<S, A> {
      if (typeof value !== "function" || value !== reducer) {
        throw new Error("Expected reducer");
      }
    }

    function getInitialState(): S {
      if (isInitializer(initializer) && isInitializerArg(initialStateOrArg)) {
        return initializer(initialStateOrArg);
      }
      if (isStateArg(initialStateOrArg)) {
        return initialStateOrArg;
      }
      return undefined;
    }

    function isStateArg(value: unknown): value is S {
      return value === initialStateOrArg && typeof initializer !== "function";
    }

    function isInitializerArg(value: unknown): value is I {
      return value === initialStateOrArg && typeof initializer === "function";
    }

    function isInitializer(value: unknown): value is (arg: I) => ReducerState<R> {
      return value === initializer && typeof value === "function";
    }
  }

  function dispatchAction<S, A>(
    hook: WorkInProgressHook<S, WorkInProgressHookQueue<S, A>>,
    action: A
  ) {
    dispatcher.updateQueue.add(() => {
      const currentState = hook.memoizedState;
      const nextState = hook.queue.lastRenderedReducer(currentState, action);
      console.log({ currentState, nextState, q: hook.queue.lastRenderedReducer, action, is: Object.is(nextState, currentState) });
      if (Object.is(nextState, currentState)) {
        return;
      }
      hook.memoizedState = nextState;
      state.change();
    });
  }

  function pushEffect(tag: number, create: EffectCallback, destroy: Destructor, deps?: unknown[]): WorkInProgressHookEffect {
    const effect: WorkInProgressHookEffect = {
      tag,
      create,
      destroy,
      deps
    };
    if (!componentUpdateQueue) {
      componentUpdateQueue = createFunctionComponentUpdateQueue();
      componentUpdateQueue.lastEffect = effect.next = effect;
    } else {
      const lastEffect = componentUpdateQueue.lastEffect;
      if (lastEffect) {
        const firstEffect = lastEffect.next;
        lastEffect.next = effect;
        effect.next = firstEffect;
        componentUpdateQueue.lastEffect = effect;
      } else {
        componentUpdateQueue.lastEffect = effect.next = effect;
      }
    }
    return effect;
  }

  async function commitHookEffectList(tag: number) {
    if (!componentUpdateQueue?.lastEffect) return;
    const firstEffect = componentUpdateQueue.lastEffect.next;
    let effect = firstEffect;
    do {
      if ((effect.tag & tag) === tag) {
        const create = effect.create;
        effect.destroy?.();
        const destroy = await create();
        effect.destroy = destroy ? destroy : undefined;
      }
      effect = effect.next;
    } while (effect !== firstEffect);
  }

  async function destroyHookEffectList(tag: number) {
    if (!componentUpdateQueue?.lastEffect) return;
    const firstEffect = componentUpdateQueue.lastEffect.next;
    let effect = firstEffect;
    do {
      if ((effect.tag & tag) === tag) {
        await effect.destroy?.();
        effect.destroy = undefined;
      }
      effect = effect.next;
    } while (effect !== firstEffect);
  }
}

function basicStateReducer<S>(state: S, action: SetStateAction<S>): S {
  return isSetStateFn(action) ? action(state) : action;
}

function createFunctionComponentUpdateQueue(): FunctionComponentUpdateQueue {
  return {
    lastEffect: undefined,
  };
}

function areHookInputsEqual(nextDeps?: unknown[], previousDeps?: unknown[]) {
  return (
    previousDeps &&
    nextDeps &&
    nextDeps.length === previousDeps.length &&
    // Find the first index with a different value
    previousDeps.findIndex((previousDep, index) => !Object.is(nextDeps[index], previousDep)) === -1
  );
}
