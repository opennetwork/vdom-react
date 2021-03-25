declare module "react-reconciler" {

  import {
  EffectCallback,
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
  useReducer,
  useContext,
  useDebugValue,
  useImperativeHandle,
  useLayoutEffect,
    Dispatch
} from "react";

  export type Destructor = () => void;

  export interface FunctionComponentUpdateQueue {
    lastEffect?: WorkInProgressHookEffect;
  }

  export interface WorkInProgressHookEffect {
    tag: number;
    create: EffectCallback;
    destroy?: Destructor;
    deps?: unknown[];
    next?: WorkInProgressHookEffect;
  }


  export interface WorkInProgressHookQueueUpdate<S, A> {
    lane: number;
    action: A;
    eagerReducer?(state: S, action: A): S;
    eagerState?: S;
    next?: WorkInProgressHookQueueUpdate<S, A>;
  }

  export interface WorkInProgressHookQueue<S, A> {
    pending?: WorkInProgressHookQueueUpdate<S, A>;
    interleaved?: unknown;
    lanes: number;
    dispatch?: Dispatch<A>;
    lastRenderedReducer(state: S, action: A): S;
    lastRenderedState: S;
  }

  export interface WorkInProgressHook<MemoizedState = unknown, Queue = unknown> {
    memoizedState?: MemoizedState;
    baseState?: unknown;
    baseQueue?: unknown;
    queue?: Queue;
    next?: unknown;
  }

  export type Lane = number;
  export type Lanes = number;
  export type RootTag = unknown;

  export interface FiberNodeConstructor<MemoizedState = unknown> {
    new (tag: unknown, pendingProps: unknown, key: unknown, mode: unknown): FiberNode<MemoizedState>;
  }

  export interface FiberQueue {

  }

  export interface FiberNode<MemoizedState = unknown> {
    prototype: {
      constructor: FiberNodeConstructor;
    };
    memoizedState: MemoizedState | null;
    updateQueue: FiberQueue | null;
  }

  export interface ReactDispatcher {
    useRef?: typeof useRef;
    useEffect?: typeof useEffect;
    useCallback?: typeof useCallback;
    useState?: typeof useState;
    useMemo?: typeof useMemo;
    useReducer?: typeof useReducer;
    useContext?: typeof useContext;
    useDebugValue?: typeof useDebugValue;
    useImperativeHandle?: typeof useImperativeHandle;
    useLayoutEffect?: typeof useLayoutEffect;
  }

  export interface SharedInternals {
    ReactCurrentDispatcher: { current?: ReactDispatcher };
    ReactCurrentOwner: { current?: FiberNode };
  }

  export interface ContainerInformation {

  }

  export interface ReactContainer {
    current?: FiberNode;
  }

  export interface HostConfig {

  }

  export interface ReactReconciler {
    createContainer(
      containerInformation: ContainerInformation,
      tag: RootTag,
      hydrate: boolean,
      hydrationCallbacks: unknown,
      strictModeLevelOverride: null | number
    ): ReactContainer;
  }

  export default function Reconciler(config: HostConfig): ReactReconciler;

}
