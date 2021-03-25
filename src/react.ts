import {
  createVNodeWithContext,
  Fragment, isSourceReference, SourceReference,
  SourceReferenceRepresentationFactory,
  VNode
} from "@opennetwork/vnode";
import { NativeAttributes, NativeOptionsVNode, setAttributes } from "@opennetwork/vdom";
import { SourceReferenceRepresentation } from "@opennetwork/vnode/src/source";
import {
  Destructor,
  FunctionComponentUpdateQueue,
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
  Fragment as ReactFragment
} from "react";
import * as NoNo from "react";
import { isIterable, isPromise } from "iterable";
import { Collector } from "microtask-collector";
import { isElement } from "@opennetwork/vdom";

const dummyContext = createContext(undefined);
const ReactProviderSymbol = dummyContext.Provider.$$typeof;
const ReactConsumerSymbol = dummyContext.Consumer.$$typeof;

const REACT_TREE = Symbol("React Tree");
const REACT_CONTEXT = Symbol("React Context");
const PROPS_BRAND = Symbol("Props");

export interface ReactVNode extends VNode {
  options: {
    setProps(props: object): void;
  };
  children: AsyncIterable<ReadonlyArray<NativeOptionsVNode | VNode & { native?: unknown }>>;
}

export interface ReactContextDescriptor<T = unknown> {
  currentValue: T;
}

export type ReactContextMap = Map<ReactContext<unknown>, ReactContextDescriptor>;

export interface ReactOptions extends Record<string, unknown> {
  [REACT_TREE]?: boolean;
  [REACT_CONTEXT]?: ReactContextMap;
}

interface DeferredAction {
  (): void | Promise<void>;
}
type DeferredActionCollector = Collector<DeferredAction, ReadonlyArray<DeferredAction>>;

export function React(options: ReactOptions, node: VNode): ReactVNode {
  type Props = { __isProps: typeof PROPS_BRAND } & Record<string, unknown>;

  const reactContext: ReactContextMap = options[REACT_CONTEXT] || new Map();

  assertSharedInternalsPresent(NoNo);
  const { __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: SharedInternals } = NoNo;

  const hooks: unknown[] = [];
  let hookIndex = -1;
  let queue: Promise<void> = Promise.resolve();
  let previousProps: Props | undefined = undefined;
  let suspendedPromise: Promise<unknown> | undefined = undefined;
  // let previousElement: Element | undefined = undefined;

  const updateQueue: DeferredActionCollector = new Collector<DeferredAction, ReadonlyArray<DeferredAction>>({
    map: Object.freeze
  });

  let componentUpdateQueue: FunctionComponentUpdateQueue | undefined = undefined;

  const { source, reference, options: props = {} } = node;

  assertProps(props);
  assertFunction(source);
  assertFragment(reference);

  let currentProps: Props = props;

  return {
    reference: Fragment,
    options: {
      setProps(props: object) {
        assertProps(props);
        updateQueue.add(() => {
          currentProps = props;
        });
      }
    },
    children: cycleChildren(source)
  };

  async function *cycleChildren(source: SourceReferenceRepresentationFactory<Props>): AsyncIterable<ReadonlyArray<VNode>> {
    const updateQueueIterator = updateQueue[Symbol.asyncIterator]();
    let updateQueueIterationResult: IteratorResult<ReadonlyArray<DeferredAction>> | undefined = undefined;
    let updateQueueIterationPromise: Promise<void> | undefined = undefined;
    const knownErrors = new WeakSet<typeof suspendedPromise>();

    do {
      updateQueueIterationResult = undefined;
      try {
        const latestValue = await cycle(source, currentProps);
        if (hookIndex === -1 && !options[REACT_TREE]) {
          yield Object.freeze([createVNodeWithContext({}, latestValue)]);
        }
        if (!latestValue) {
          yield Object.freeze([]);
        } else {
          assertReactElement(latestValue);
          yield Object.freeze([map(updateQueue, reactContext, latestValue)]);
        }
      } catch (error) {
        if (isPromise(error)) {
          // If we are here, and we know this error, it was already thrown and resolved
          if (!knownErrors.has(error)) {
            suspendedPromise = error.then(() => suspendedPromise = undefined);
            knownErrors.add(error);
          }
        } else {
          console.error({ error });
          await Promise.reject(error);
        }
      }

      if (!updateQueueIterationResult) {
        updateQueueIterationPromise = updateQueueIterationPromise || updateQueueIterator.next()
          .then((result) => {
            updateQueueIterationResult = result;
            updateQueueIterationPromise = undefined;
          });
      }

      if (suspendedPromise && updateQueueIterationPromise) {
        await Promise.any([
          suspendedPromise,
          updateQueueIterationPromise
        ]);
      } else if (updateQueueIterationPromise) {
        await updateQueueIterationPromise;
        updateQueueIterationPromise = undefined;
      } else if (suspendedPromise) {
        await suspendedPromise;
        suspendedPromise = undefined;
      }

      for (const update of updateQueueIterationResult?.value ?? []) {
        await update();
      }
      if (!updateQueueIterationResult?.done) {
        // Clear for next loop
        updateQueueIterationResult = undefined;
      }

    } while (!updateQueueIterationResult?.done);

    await destroyHookEffectList(0);
  }

  async function cycle(source: SourceReferenceRepresentationFactory<Props>, props: Props) {
    queue = Promise.resolve();
    hookIndex = -1;
    componentUpdateQueue = undefined;

    const latestValue = await renderWithHooks(source, props);

    if (hookIndex === -1) {
      // We are rendering only, no hooks utilised
      return latestValue;
    }

    await commitHookEffectList(0);

    previousProps = props;
    return latestValue;
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

  async function renderWithHooks(source: SourceReferenceRepresentationFactory<Props>, props: Props): Promise<SourceReferenceRepresentation<Props>> {
    hookIndex = -1;

    SharedInternals.ReactCurrentDispatcher.current = {
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
      const found = reactContext.get(context);
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

  function useCallback<T extends () => void>(nextCallback: T, deps?: unknown[]): T {
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

  function useEffect(create: EffectCallback, deps?: unknown[]) {
    const hook = useWorkInProgress<WorkInProgressHookEffect>();
    if (hook.memoizedState && deps && areHookInputsEqual(deps, hook.memoizedState.deps)) {
      return hook.memoizedState;
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

export function map(collector: DeferredActionCollector, reactContext: ReactContextMap, element: unknown): VNode {
  const context = {};

  if (isReactContextConsumerElement(element)) {
    const foundContext = reactContext.get(element.type._context);
    const result = element.props.children(foundContext?.currentValue);
    if (result) {
      return map(collector, reactContext, result);
    }
  } else if (isReactContextProviderElement(element)) {
    const nextReactContext = new Map(reactContext);
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
      children: mapChildren(element.props.children, nextReactContext)
    };
  } else if (isReactElement(element)) {
    const { type, props } = element;
    if (type === ReactFragment) {
      return {
        reference: Fragment,
        options: {},
        source: element,
        children: mapChildren(element.props.children, reactContext)
      };
    } else if (typeof type === "function") {
      return createVNodeWithContext(context, () => React({ [REACT_TREE]: true, [REACT_CONTEXT]: reactContext }, { reference: Fragment, source: type, options: props || {} }));
    } else {
      return createSourceNode(element, type);
    }
  }
  return { reference: Fragment, source: element };

  async function *mapChildren(children: unknown, childrenReactContext: ReactContextMap = reactContext): AsyncIterable<ReadonlyArray<VNode>> {
    return yield asVNode(children);

    function asVNode(source: ReactElement | ReactNode | SourceReference): VNode[] {
      if (typeof source === "undefined") {
        return [];
      }
      if (isSourceReference(source)) {
        // Bypass rest of the jazz
        return [createVNodeWithContext({}, source)];
      }
      if (isReactNodeArray(source)) {
        return reduce(source);
      }
      if (isReactElement(source)) {
        return [map(collector, childrenReactContext, source)];
      }
      return [];
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
      children: mapChildren(props.children)
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
      value.type === ReactFragment
    )
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
