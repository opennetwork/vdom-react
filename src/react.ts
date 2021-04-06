import {
  createVNode,
  Fragment, isSourceReference, isVNode, SourceReference,
  SourceReferenceRepresentationFactory,
  VNode
} from "@opennetwork/vnode";
import { NativeAttributes, NativeOptionsVNode, setAttributes } from "@opennetwork/vdom";
import {
  Destructor,
  FunctionComponentUpdateQueue,
  ReactDispatcher,
  SharedInternals,
  WorkInProgressHook,
  WorkInProgressHookEffect,
  WorkInProgressHookQueue,
} from "react-reconciler";
import {
  Dispatch,
  DispatchWithoutAction,
  EffectCallback,
  MutableRefObject,
  ReactElement,
  ReactNode,
  Reducer,
  ReducerAction,
  ReducerState,
  ReducerStateWithoutAction,
  ReducerWithoutAction,
  RefObject,
  SetStateAction,
  Context as ReactContext,
  Provider as ReactProvider,
  Consumer as ReactConsumer,
  ProviderExoticComponent,
  ProviderProps,
  createContext,
  Fragment as ReactFragment,
  Component as ReactComponent,
  ComponentClass as ReactComponentClass,
  ForwardRefExoticComponent as ReactForwardRefExoticComponent,
  PropsWithoutRef,
  RefAttributes,
  forwardRef,
  createElement as createReactElement, createRef
} from "react";
import * as NoNo from "react";
import { isIterable, isPromise } from "iterable";
import { Collector } from "microtask-collector";
import { isElement } from "@opennetwork/vdom";
import { Controller, RenderMeta } from "./controller";
import { Deferred, deferred } from "./deferred";

const throwAwayContext = createContext(undefined);
const ReactProviderSymbol = throwAwayContext.Provider.$$typeof;
const ReactConsumerSymbol = throwAwayContext.Consumer.$$typeof;
const throwAwayForwardRef = forwardRef(() => createReactElement(ReactFragment));
const ReactForwardRefSymbol = throwAwayForwardRef.$$typeof;

const IS_IN_REACT_TREE = Symbol("This component is part of a react tree");
const CONTEXT = Symbol("Context");
const ERROR_BOUNDARY = Symbol("Error Boundary");
const CONTROLLER = Symbol("Controller");
const ITERATE_UPDATE_QUEUE = Symbol("Iterate update queue");
const PARENT = Symbol("Parent ReactVNode");

export const DISPATCHER = Symbol("✨ Dispatcher ✨");

export function dispatcher(props: unknown): ReactDispatcher {
  assertDispatcherProps(props);
  return props[DISPATCHER];

  function assertDispatcherProps(props: unknown): asserts props is { [DISPATCHER]: ReactDispatcher } {
    function isDispatcherPropsLike(props: unknown): props is { [DISPATCHER]: unknown } {
      return !!props;
    }
    if (
      isDispatcherPropsLike(props) &&
      !!props[DISPATCHER]
    ) {
      return;
    }
    throw new Error("Expected dispatcher");
  }
}

interface DeferredAction {
  (): unknown;
}
type DeferredActionCollector = Collector<DeferredAction, ReadonlyArray<DeferredAction>>;

export type ReactVNodeChildren = ReadonlyArray<NativeOptionsVNode | VNode & { native?: unknown }>;
export interface ContinueFn {
  (): boolean;
}
export type ContinueFlag = ContinueFn | undefined;

const VNODE = Symbol("React VNode");

export interface ReactVNode extends VNode {
  [VNODE]: true;
  options: {
    setProps(props: object): void;
    updateQueue: DeferredActionCollector,
    readonly stateChanged: boolean;
    readonly parent: ReactVNode
    destroy(): Promise<void>;
    setContinueFlag(continueFlag: ContinueFlag): void
  };
  children: AsyncIterable<ReactVNodeChildren>;
}

export function isReactVNode(node: VNode): node is ReactVNode {
  function isReactVNodeLike(node: unknown): node is { [VNODE]: unknown } {
    return !!node;
  }
  return isReactVNodeLike(node) && node[VNODE] === true;
}

export function assertReactVNode(node: VNode): asserts node is ReactVNode {
  if (!isReactVNode(node)) {
    throw new Error("Expected ReactVNode");
  }
}

export interface ReactContextDescriptor<T = unknown> {
  currentValue: T;
}

export type ReactContextMap = Map<ReactContext<unknown>, ReactContextDescriptor>;

export interface ReactOptions extends Record<string, unknown> {
  [IS_IN_REACT_TREE]: boolean;
  [CONTROLLER]: Controller;
  [CONTEXT]: ReactContextMap;
  [ERROR_BOUNDARY](error: unknown): boolean;
  [PARENT]?: ReactVNode;
}

function isReactOptions(options: Partial<ReactOptions>): options is ReactOptions {
  return !!(options[IS_IN_REACT_TREE] && options[CONTROLLER] && options[CONTEXT] && options[ERROR_BOUNDARY]);
}

export function React(options: Partial<ReactOptions>, node: VNode): ReactVNode {
  const PROPS_BRAND = Symbol("This object is branded as this components props");

  if (!isReactOptions(options)) {
    return React(
      {
        [IS_IN_REACT_TREE]: true,
        [CONTROLLER]: new Controller(),
        [CONTEXT]: new Map(),
        [ERROR_BOUNDARY]: () => undefined,
        ...options
      },
      node
    );
  }

  if (isReactElement(node.source) && typeof node.source.type === "function") {
    return React(
      options,
      {
        reference: node.source.key || Fragment,
        source: node.source.type,
        options: node.source.props
      }
    );
  }

  type Props = {
    __isProps: typeof PROPS_BRAND,
    [ITERATE_UPDATE_QUEUE]?: boolean
  } & Record<string, unknown>;

  assertSharedInternalsPresent(NoNo);
  const { __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: SharedInternals } = NoNo;

  const hooks: unknown[] = [];
  let hookIndex = -1;
  let queue: Promise<void> = Promise.resolve();
  let previousProps: Props | undefined = undefined;

  const instance = new Map<ReactComponentClass<Props, unknown>, InstanceType<ReactComponentClass<Props, unknown>>>();

  const updateQueue: DeferredActionCollector = new Collector<DeferredAction, ReadonlyArray<DeferredAction>>({
    map: Object.freeze,
    eagerCollection: true
  });
  const updateQueueIterator = updateQueue[Symbol.asyncIterator]();

  let componentUpdateQueue: FunctionComponentUpdateQueue | undefined = undefined;

  const dispatcher = {
    useRef,
    useMemo,
    useCallback,
    useEffect,
    useLayoutEffect: useEffect,
    useState,
    useReducer,
    useContext,
    useDebugValue: noop,
    useImperativeHandle: noop,
  };

  const { source, reference, options: props = {} } = node;

  assertProps(props);
  assertFunction(source);
  assertFragment(reference);

  let currentProps: Props = props,
    previousState: unknown = undefined,
    currentStateChange = Symbol(),
    previousStateChange = Symbol(),
    caughtError: unknown = undefined,
    isDestroyable = false,
    destroyed = false,
    rendering: Promise<void> | undefined,
    continueFlag: () => boolean | undefined = () => false;

  setCurrentProps(props);

  const controller = options[CONTROLLER];

  const populatedNode: ReactVNode = {
    [VNODE]: true,
    reference: Fragment,
    options: {
      setProps,
      setContinueFlag,
      updateQueue,
      get stateChanged() {
        return currentStateChange !== previousStateChange || updateQueue.size > 0;
      },
      get parent() {
        return options[PARENT];
      },
      destroy
    },
    children: {
      [Symbol.asyncIterator]: renderGenerator.bind(undefined, options, source)
    }
  };
  controller.hello?.(populatedNode);
  return populatedNode;

  async function destroy() {
    isDestroyable = true;
    if (destroyed) return;
    // Push an update where it will see that the component is destroyed
    updateQueue.add(() => {});
    while (!destroyed && rendering) await rendering;
    if (!destroyed) {
      await actuallyDestroy();
    }
  }

  async function actuallyDestroy() {
    isDestroyable = true;
    destroyed = true;
    await controller.beforeDestroyed?.(populatedNode);
    await destroyHookEffectList(0);
    await controller.afterDestroyed?.(populatedNode);
    updateQueue.close();
  }

  function setContinueFlag(givenContinueFlag: typeof continueFlag) {
    continueFlag = givenContinueFlag;
  }

  function setProps(props: object) {
    updateQueue.add(setCurrentProps.bind(undefined, props));
  }

  function setCurrentProps(props: object) {
    if (props === currentProps) {
      return;
    }
    assertProps(props);
    if (Object.isExtensible(props)) {
      Object.defineProperty(props, DISPATCHER, {
        value: dispatcher
      });
    }
    currentProps = props;
    currentStateChange = Symbol();
  }

  async function *renderGenerator(options: ReactOptions, source: SourceReferenceRepresentationFactory<Props>): AsyncIterable<ReadonlyArray<VNode>> {
    const knownPromiseErrors = new WeakSet<Promise<unknown>>();
    let renderedStateChange = previousStateChange,
      renderedProps = previousProps,
      renderMeta: RenderMeta,
      renderDeferred: Deferred;

    do {
      console.log("render", source, continueFlag);
      queue = Promise.resolve();
      hookIndex = -1;
      componentUpdateQueue = undefined;

      const renderingProps = currentProps;
      const renderingStateChange = currentStateChange;

      renderMeta = {
        parent: options[PARENT],
        onError,
        currentChange: currentStateChange,
        currentProps,
        previousChange: renderedStateChange,
        previousProps: renderedProps
      };

      if (renderedStateChange !== currentStateChange) {
        try {
          if (!await controller.beforeRender?.(populatedNode, renderMeta)) break;
          let renderResult;
          renderDeferred = deferred();
          rendering = renderDeferred.promise;
          try {
            renderResult = await render(options, source, renderingProps);
          } finally {
            renderDeferred.resolve();
            if (renderDeferred.promise === rendering) {
              rendering = undefined;
            }
          }
          if (!renderResult) {
            renderedStateChange = previousStateChange = renderingStateChange;
            // This will jump to our update queue
            continue;
          }
          const [latestValue, childrenOptions] = renderResult;
          if (hookIndex === -1 && !childrenOptions[IS_IN_REACT_TREE]) {
            if (isVNode(latestValue) || isSourceReference(latestValue)) {
              yield Object.freeze([createVNode(latestValue)]);
            } else {
              yield Object.freeze([]);
            }
          }
          if (!latestValue) {
            yield Object.freeze([]);
          } else {
            assertReactElement(latestValue);
            yield Object.freeze([map(updateQueue, { ...childrenOptions, [PARENT]: populatedNode }, latestValue)]);
          }
          // If we use the symbol that was present as render started, it allows for things to happen
          // _while_ we render outside of this cycle
          renderedStateChange = previousStateChange = renderingStateChange;
          renderedProps = previousProps = renderingProps;
        } catch (error) {
          if (await onError(error)) {
            break;
          }
        }
      }
      await commitHookEffectList(0);
      if (hookIndex > -1 && (continueFlag?.() ?? true)) {
        if (!(await waitForUpdates())) {
          break;
        }
      }
    } while (!isDestroyable && (continueFlag?.() ?? true) && (await controller.afterRender?.(populatedNode, renderMeta) ?? true) && hookIndex > -1 && options[CONTROLLER]?.aborted !== true && !caughtError);

    if (caughtError) {
      await actuallyDestroy();
      await Promise.reject(caughtError);
    }

    async function waitForUpdates(): Promise<boolean> {
      const update = async () => {
        const updateQueueIterationResult = await updateQueueIterator.next();
        for (const update of updateQueueIterationResult.value ?? []) {
          try {
            await update();
          } catch (error) {
            if (await renderMeta.onError(error)) {
              return false;
            }
          }
        }
      };
      const { parent } = renderMeta;
      if (node === parent || !parent) {
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
      if (isPromise(error)) {
        const promiseError: Promise<unknown> = error;
        // If we are here, and we know this error, it was already thrown and resolved
        // Else we already know about it and it is in our update queue
        if (!knownPromiseErrors.has(error)) {
          updateQueue.add(() => promiseError);
          knownPromiseErrors.add(error);
        }
        return false;
      } else if (await options[ERROR_BOUNDARY](error)) {
        // If the error boundary returned true, the error should be thrown later on
        caughtError = error;
        await updateQueueIterator.return?.();
      }
      return true;
    }
  }

  async function render(options: ReactOptions, source: SourceReferenceRepresentationFactory<Props>, props: Props): Promise<[unknown, ReactOptions]>  {
    if (isReactComponent<Props, Record<string, unknown>>(source)) {
      return renderComponent(options, source, props);
    }

    const latestValue = await renderFunction(source, props);

    if (hookIndex === -1) {
      // We are rendering only, no hooks utilised
      return [latestValue, options];
    }

    return [latestValue, options];
  }

  async function renderComponent(options: ReactOptions, source: ReactComponentClass<Props, unknown>, props: Props, initialState: Record<string, unknown> = source.prototype.state): Promise<[unknown, ReactOptions] | undefined>  {
    const currentInstance = instance.get(source);
    if (!currentInstance) {
      const newInstance = new source(props);
      instance.set(source, newInstance);
      let initialState = newInstance.state ?? {};
      if (source.getDerivedStateFromProps) {
        const nextState = source.getDerivedStateFromProps(props, initialState);
        if (nextState && nextState !== initialState) {
          initialState = {
            ...initialState,
            ...nextState
          };
        }
      }
      return renderComponent(options, source, props, initialState);
    }

    const [state, setState] = useReducer((previousState: Record<string, unknown>, nextStateAction: SetStateAction<Record<string, unknown>>) => {
      const nextState = typeof nextStateAction === "function" ? nextStateAction(previousState) : nextStateAction;
      if (!nextState || nextState === previousState) {
        return previousState;
      }
      return {
        ...previousState,
        ...nextState
      };
    }, initialState ?? {});

    if (source.getDerivedStateFromProps && previousProps !== currentProps) {
      setState((previousState) => source.getDerivedStateFromProps?.(currentProps, previousState));
    }

    Object.defineProperty(currentInstance, "forceUpdate", {
      value: useForceUpdate()
    });

    Object.defineProperty(currentInstance, "setState", {
      value: setState
    });

    const childrenOptions: ReactOptions = {
      ...options
    };

    const errorBoundary = useErrorBoundary(currentInstance, source);
    if (isReactErrorBoundaryInstance(currentInstance) || source.getDerivedStateFromError) {
      childrenOptions[ERROR_BOUNDARY] = errorBoundary;
    }
    const nextContext = {};

    const snapshot = currentInstance.getSnapshotBeforeUpdate?.(previousProps, previousState);

    const shouldUpdate = !currentInstance.shouldComponentUpdate || currentInstance.shouldComponentUpdate(currentProps, state, nextContext);

    if (shouldUpdate === false) {
      return undefined;
    }

    if (!snapshot && !source.getDerivedStateFromProps) {
      currentInstance.componentWillMount?.();
      currentInstance.UNSAFE_componentWillMount?.();

      if (previousProps !== currentProps) {
        currentInstance.componentWillReceiveProps?.(currentProps, nextContext);
        currentInstance.UNSAFE_componentWillReceiveProps?.(currentProps, nextContext);
      }

      currentInstance.componentWillUpdate?.(currentProps, state, nextContext);
      currentInstance.UNSAFE_componentWillUpdate?.(currentProps, state, nextContext);
    }

    Object.defineProperty(currentInstance, "state", {
      value: state
    });
    Object.defineProperty(currentInstance, "props", {
      value: currentProps
    });

    const result: [unknown, ReactOptions] = [currentInstance.render(), childrenOptions];

    currentInstance.componentDidMount?.();
    currentInstance.componentDidUpdate?.(previousProps, previousState, snapshot);

    useUnmount(currentInstance.componentWillUnmount);

    previousState = state;
    return result;
  }

  function useForceUpdate() {
    return useCallback(() => {
      updateQueue.add(() => {
        currentStateChange = Symbol();
      });
    }, []);
  }

  function useUnmount(unmount?: () => void) {
    return useEffect(() => {
      if (!unmount) return;
      return () => {
        unmount();
      };
    }, [unmount]);
  }

  function useErrorBoundary<S>(instance: ReactComponent<Props, Partial<S>>, source: ReactComponentClass<Props, Partial<S>>) {
    return useCallback((error: unknown): boolean => {
      let handled = false;
      const nextState = source.getDerivedStateFromError?.(error);
      if (typeof nextState !== "undefined") {
        instance.setState(nextState);
        handled = true;
      }
      // According type react types, componentDidCatch only receives actual error instances
      if (error instanceof Error) {
        instance.componentDidCatch?.(error, {
          componentStack: error.stack ?? ""
        });
        handled = true;
      }
      return !handled;
    }, [instance, source, instance.setState]);
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

  function assertFunction(source: unknown): asserts source is SourceReferenceRepresentationFactory<Props> {
    if (typeof source !== "function") {
      throw new Error("Expected function source");
    }
  }

  function assertFragment(reference: unknown): asserts reference is typeof Fragment {
    if (reference !== Fragment) {
      throw new Error("Expected fragment reference");
    }
  }

  function assertProps(props: unknown): asserts props is Props {
    if (!props) {
      throw new Error("Expected props");
    }
  }

  async function renderFunction(source: (props: Props, children: VNode) => unknown, props: Props): Promise<unknown> {
    hookIndex = -1;
    SharedInternals.ReactCurrentDispatcher.current = dispatcher;
    const returnedValue = source(props, { reference: Fragment, children: node.children } );
    SharedInternals.ReactCurrentOwner.current = undefined;
    SharedInternals.ReactCurrentDispatcher.current = undefined;
    return returnedValue;
  }

  function noop(): void {
    return undefined;
  }

  function useContext<T>(context: ReactContext<T>): T {
    return readContext(context);

    function readContext(context: unknown): T {
      assertReactContext(context);
      const found = options[CONTEXT]?.get(context);
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

  function useRef<T>(initialValue: T): MutableRefObject<T>;
  function useRef<T>(initialValue: T|null): RefObject<T>;
  function useRef<T = undefined>(): MutableRefObject<T | undefined>;
  function useRef<T>(initial?: T): MutableRefObject<T> {
    const hook = useWorkInProgress<MutableRefObject<T>>();
    if (!hook.memoizedState) {
      hook.memoizedState = {
        current: initial
      };
    }
    return hook.memoizedState;
  }

  function useMemo<T>(nextCreate: () => T, deps?: unknown[]): T {
    const hook = useWorkInProgress<[T, unknown[]]>();
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

  function useCallback<T extends (...args: unknown[]) => unknown>(nextCallback: T, deps?: unknown[]): T {
    const hook = useWorkInProgress<[T, unknown[]]>();
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
    const hook = useWorkInProgress<WorkInProgressHookEffect>();
    if (hook.memoizedState && deps && areHookInputsEqual(deps, hook.memoizedState.deps)) {
      return;
    }
    hook.memoizedState = pushEffect(0, create, hook.memoizedState?.destroy, deps);
  }

  function useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  function useState<S>(initialState?: (() => S) | S): [S, Dispatch<SetStateAction<S>>] {
    const hook = useWorkInProgress<S, WorkInProgressHookQueue<S, SetStateAction<S>>>();
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
    const hook = useWorkInProgress<S, WorkInProgressHookQueue<S, A>>();
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
    updateQueue.add(() => {
      const currentState = hook.memoizedState;
      const nextState = hook.queue.lastRenderedReducer(currentState, action);
      if (Object.is(nextState, currentState)) {
        return;
      }
      hook.memoizedState = nextState;
      currentStateChange = Symbol();
    });
  }

  function basicStateReducer<S>(state: S, action: SetStateAction<S>): S {
    return isSetStateFn(action) ? action(state) : action;
  }

  function isSetStateFn<S>(initialState: SetStateAction<S>): initialState is ((state: S) => S) {
    return typeof initialState === "function";
  }


  function areHookInputsEqual(nextDeps: unknown[], previousDeps?: unknown[]) {
    if (!previousDeps) {
      return false;
    }
    if (nextDeps.length !== previousDeps.length) {
      return false;
    }
    for (let i = 0; i < previousDeps.length && i < nextDeps.length; i++) {
      if (Object.is(nextDeps[i], previousDeps[i])) {
        continue;
      }
      return false;
    }
    return true;
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

  function createFunctionComponentUpdateQueue(): FunctionComponentUpdateQueue {
    return {
      lastEffect: undefined,
    };
  }

  function useWorkInProgress<MemoizedState, Queue = unknown>(): WorkInProgressHook<MemoizedState, Queue> {
    const index = hookIndex += 1;
    const current = hooks[index];
    if (isWorkInProgressHook(current)) {
      return current;
    }
    const hook: WorkInProgressHook<MemoizedState, Queue> = {};
    hooks[index] = hook;
    return hook;

    function isWorkInProgressHook(current: unknown): current is WorkInProgressHook<MemoizedState, Queue> {
      return !!current;
    }

  }
}

export function map(collector: DeferredActionCollector, options: Partial<ReactOptions>, element: unknown): VNode {
  if (isReactContextConsumerElement(element)) {
    const foundContext = options[CONTEXT]?.get(element.type._context);
    const result = element.props.children(foundContext?.currentValue);
    if (result) {
      return map(collector, options, result);
    }
  } else if (isReactContextProviderElement(element)) {
    const nextReactContext = new Map(options[CONTEXT]);
    nextReactContext.set(element.type._context, {
      currentValue: element.props.value
    });
    return {
      reference: Fragment,
      options: {
        context: element.type._context,
        value: element.props.value
      },
      source: element,
      children: mapChildren(element.props.children, {
        ...options,
        [CONTEXT]: nextReactContext
      })
    };
  } else if (isReactForwardRefExoticElement(element)) {
    const { type, props, ref } = element;
    if (!isReactForwardRefExoticComponent(type)) {
      throw new Error("Expected ref element");
    }
    const { render: source } = type;
    const render = source.bind(undefined, props, ref || createRef());
    return createVNode(() => React(options, { reference: Fragment, source: render, options: props || {} }));
  } else if (isReactElement(element)) {
    const { type, props } = element;
    if (type === ReactFragment) {
      return {
        reference: Fragment,
        options: {},
        source: element,
        children: mapChildren(element.props.children, options)
      };
    } else if (typeof type === "function") {
      return createVNode(() => React(options, { reference: Fragment, source: type, options: props || {} }));
    } else {
      return createSourceNode(element, type);
    }
  }
  return { reference: Fragment, source: element };

  async function *mapChildren(children: unknown, options: Partial<ReactOptions>): AsyncIterable<ReadonlyArray<VNode>> {
    return yield asVNode(children);

    function asVNode(source: ReactElement | ReactNode | SourceReference | SourceReferenceRepresentationFactory<object>): VNode[] {
      if (typeof source === "undefined") {
        return [];
      }
      if (isSourceFunction(source)) {
        return [createVNode(source)];
      } else if (isSourceReference(source)) {
        // Bypass rest of the jazz
        return [createVNode(source)];
      }
      if (isReactNodeArray(source)) {
        return reduce(source);
      }
      if (isReactElement(source)) {
        return [map(collector, options, source)];
      }
      return [];
    }

    function isSourceFunction<O extends object = object>(source: unknown): source is SourceReferenceRepresentationFactory<O> {
      return typeof source === "function";
    }

    // Typescript doesn't like reducing react node -> vnode ???
    function reduce(input: Iterable<ReactNode>): VNode[] {
      const nodes: VNode[] = [];
      for (const value of input) {
        nodes.push(...asVNode(value));
      }
      return nodes;
    }

    function isReactNodeArray(source: ReactElement | ReactNode | SourceReference): source is Iterable<ReactNode> {
      return isIterable(source);
    }
  }
  function createSourceNode({ props, key, ref }: ReactElement & { ref?: unknown }, source: string): NativeOptionsVNode {
    const node: NativeOptionsVNode = {
      source,
      reference: key || Symbol("React"),
      options: {
        type: "Element",
        async onBeforeRender(documentNode: Element & ProxiedListeners | Text) {
          if (!isElement(documentNode)) return;
          documentNode._collector = documentNode._collector ?? collector;

          const attributes: NativeAttributes = {};
          let hasAttribute = false;
          for (const key of Object.keys(props)) {
            if (key === "key" || key === "children") {
              // These are react specific props, they also trigger warnings on read
              continue;
            }
            const value = props[key];
            if (key === "value" || key === "checked") {
              // Do nothing, use defaultValue or defaultChecked attribute
              continue;
            } else if (key === "class" || key === "className") {
              if (typeof value === "string") {
                documentNode.className = value;
              } else {
                documentNode.className = "";
              }
              continue;
            } else if (key === "dangerouslySetInnerHTML") {
              documentNode.innerHTML = props["dangerouslySetInnerHTML"];
            } else if (key === "style") {
              // TODO
              // if (typeof value === "string") {
              //   assertStyleText(documentNode.style);
              //   documentNode.style.cssText = value;
              // } else {
              //   // TODO
              // }
              continue;
            } else if (key.startsWith("on")) {
              const keyWithoutCapture = key.replace(/Capture$/, "");
              const useCapture = keyWithoutCapture !== key;
              let name = keyWithoutCapture;
              if (name.toLowerCase() in documentNode) {
                name = name.toLowerCase();
              }
              name = name.slice(2);
              const handler = useCapture ? eventProxyCapture : eventProxy;
              if (typeof value === "function") {
                documentNode._listeners = documentNode._listeners ?? {};
                documentNode._listeners[name + useCapture] = value;
                documentNode.addEventListener(name, handler, useCapture);
              } else {
                documentNode.removeEventListener(name, handler, useCapture);
              }
              continue;
            } else if (
              isDocumentNodeKey(key) &&
              !isReadOnlyDocumentKey(key)
            ) {
              const documentNodeMap: Record<keyof Element, unknown> = documentNode;
              try {
                documentNodeMap[key] = value;
                continue;
              } catch {

              }
            }
            if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "undefined" || value === null) {
              let name = key;
              if (key === "htmlFor") name = "for";
              attributes[key] = value;
              hasAttribute = true;
            }
          }
          if (hasAttribute) {
            await setAttributes({
              ...node,
              options: {
                ...node.options,
                attributes
              }
            }, documentNode);
          }

          if (typeof ref === "function") {
            ref(documentNode);
          } else if (isMutableRef(ref)) {
            ref.current = documentNode;
          }

          function isDocumentNodeKey<K>(key: K): key is K & keyof Element {
            return key in documentNode;
          }

          function isMutableRef(input: unknown): input is MutableRefObject<Element> {
            function isMutableRefLike(input: unknown): input is Record<string, unknown> {
              return !!input && input === ref;
            }
            return isMutableRefLike(input) && "current" in input;
          }

        }
      },
      children: mapChildren(props.children, options)
    };
    return node;
  }
}

const readOnlyElementKeys = {
  href: 1,
  list: 1,
  form: 1,
  tabIndex: 1,
  download: 1,
  target: 1,
};

function isReadOnlyDocumentKey(key: string): key is keyof typeof readOnlyElementKeys {
  const keys: Record<string, number> = readOnlyElementKeys;
  return !!keys[key];
}

export interface ProxiedListeners {
  _listeners?: Record<string, (event: Event) => void>;
  _collector?: Collector<DeferredAction, ReadonlyArray<DeferredAction>>;
}

function eventProxy(this: ProxiedListeners, event: Event) {
  scopedEvent.call(this, event, false);
}

function eventProxyCapture(this: ProxiedListeners, event: Event) {
  scopedEvent.call(this, event, true);
}

function scopedEvent(this: ProxiedListeners, event: Event, useCapture: boolean) {
  if (!this._listeners) {
    return;
  }
  const fn = this._listeners?.[event.type + useCapture];
  if (typeof fn === "function") {
    const result = fn(event);
    if (isPromise(result)) {
      const action: DeferredAction & { priority?: number, render?: boolean } = () => result;
      action.priority = 1;
      action.render = false;
      this._collector?.add(action);
    }
  }
}


function assertSharedInternalsPresent(value: unknown): asserts value is {
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: SharedInternals
} {
  function isSharedInternalsPresentLike(value: unknown): value is {
    __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: unknown
  } {
    return !!value;
  }
  if (!(isSharedInternalsPresentLike(value) && value.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED)) {
    throw new Error("Expected to be fired!");
  }
}

function isReactElement(value: unknown): value is ReactElement {
  function isReactElementLike(value: unknown): value is { type: unknown } {
    return !!value;
  }
  return (
    isReactElementLike(value) &&
    (
      typeof value.type === "function" ||
      typeof value.type === "string" ||
      isReactContextConsumerElement(value) ||
      isReactContextProviderElement(value) ||
      isReactForwardRefExoticElement(value) ||
      value.type === ReactFragment
    )
  );
}

function isReactForwardRefExoticElement<T = unknown, P = object>(value: unknown): value is ReactElement<P, ReactForwardRefExoticComponent<PropsWithoutRef<P> & RefAttributes<T>> & { render(props: P, ref: MutableRefObject<unknown>): unknown }> & { ref: MutableRefObject<unknown> } {
  function isReactForwardRefExoticElementLike(value: unknown): value is { type: unknown } {
    return !!value;
  }
  return isReactForwardRefExoticElementLike(value) && isReactForwardRefExoticComponent(value.type);
}

function isReactForwardRefExoticComponent<T = unknown, P = unknown>(value: unknown): value is ReactForwardRefExoticComponent<PropsWithoutRef<P> & RefAttributes<T>> & { render(props: P, ref: MutableRefObject<unknown>): unknown } {
  function isReactForwardRefExoticComponentLike(value: unknown): value is Partial<ReactForwardRefExoticComponent<PropsWithoutRef<P> & RefAttributes<T>>> & { render: unknown } {
    return !!value;
  }
  return (
    isReactForwardRefExoticComponentLike(value) &&
    value.$$typeof === ReactForwardRefSymbol &&
    typeof value.render === "function"
  );
}

function isReactContextProviderElement<T = unknown>(value: unknown): value is ReactElement<{ value: T, children?: ReactNode }, ReactProviderWithContext<T>> {
  function isReactContextProviderElementLike(value: unknown): value is { type: unknown } {
    return !!value;
  }
  return isReactContextProviderElementLike(value) && isReactContextProvider(value.type);
}

interface ReactProviderWithContext<T> extends ReactProvider<T> {
  _context: ReactContext<T>;
}

function isReactContextProvider<T = unknown>(value: unknown): value is ReactProviderWithContext<T> {
  function isReactContextProviderLike(value: unknown): value is Partial<ProviderExoticComponent<ProviderProps<T>>> {
    return !!value;
  }
  return (
    isReactContextProviderLike(value) &&
    value.$$typeof === ReactProviderSymbol
  );
}

function isReactContextConsumerElement<T = unknown>(value: unknown): value is ReactElement<{ children(value: T): ReactNode }, ReactConsumerWithContext<T>> {
  function isReactContextConsumerElementLike(value: unknown): value is { type: unknown } {
    return !!value;
  }
  return isReactContextConsumerElementLike(value) && isReactContextConsumer(value.type);
}

interface ReactConsumerWithContext<T> extends ReactConsumer<T> {
  _context: ReactContext<T>;
}

function isReactContextConsumer<T = unknown>(value: unknown): value is ReactConsumerWithContext<T> {
  function isReactContextConsumerLike(value: unknown): value is Partial<ProviderExoticComponent<ProviderProps<T>>> {
    return !!value;
  }
  return (
    isReactContextConsumerLike(value) &&
    value.$$typeof === ReactConsumerSymbol
  );
}

function isReactContext<T = unknown>(value: unknown): value is ReactContext<T> & {
  $$type: symbol,
  _calculateChangedBits?: (a: T, b: T) => number,
  _currentValue: T,
  _currentValue2?: T
} {
  function isReactContextLike(value: unknown): value is { Provider: unknown, Consumer: unknown, displayName: unknown } {
    return !!value;
  }
  return (
    isReactContextLike(value) &&
    isReactContextConsumer(value.Consumer) &&
    isReactContextProvider(value.Provider) &&
    (!value.displayName || typeof value.displayName === "string")
  );
}


function assertReactElement(value: unknown): asserts value is ReactElement {
  if (!isReactElement(value)) {
    throw new Error("Expected ReactElement");
  }
}

function isReactComponent<T, S extends object = Record<string, unknown>>(value: unknown): value is ReactComponentClass<T, S> {
  function isPrototypeLike(value: unknown): value is { prototype: unknown } {
    return typeof value === "function";
  }
  return (
    isPrototypeLike(value) &&
    value.prototype instanceof ReactComponent
  );
}

function isReactErrorBoundaryInstance<P, S>(value: ReactComponent<P, S>): value is InstanceType<ReactComponentClass<P, S>> {
  function isReactErrorBoundaryLike(value: unknown): value is Record<string, unknown> {
    return !!value;
  }
  return (
    isReactErrorBoundaryLike(value) &&
    (
      typeof value.componentDidCatch === "function"
    )
  );
}
