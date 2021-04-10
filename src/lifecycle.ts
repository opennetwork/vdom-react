import {
  ComponentLifecycle as ReactComponentLifecycle,
  SetStateAction,
  StaticLifecycle as ReactStaticLifecycle,
  Reducer as ReactReducer, useCallback, Dispatch
} from "react";
import { ReactDispatcher } from "react-reconciler";
import { ReactOptions, ReactVNode } from "./react";

export type State = Record<string, unknown>;

export interface StateContainer<S extends State, P> {
  state: S;
  setState: Dispatch<SetStateAction<S>>;
  props?: P;
}

export interface RenderFn<S extends State = State, P = unknown, O = unknown> {
  (this: StateContainer<S, P>, props: P, state: S): O;
}

export interface LifecycleContext<P = unknown, S extends State = State, O = unknown> {
  node: ReactVNode;
  dispatcher: ReactDispatcher;
  staticLifecycle: ReactStaticLifecycle<P, S>;
  lifecycle: ReactComponentLifecycle<P, S>;
  stateContainer: StateContainer<S, P>;
  previousProps: Readonly<P>;
  props: Readonly<P>;
  render: RenderFn<S, P, O>;
}

export class AbortLifecycleError {
  readonly name = "AbortLifecycleError";
}

export function isAbortLifecycleError(error: unknown): error is AbortLifecycleError {
  return error instanceof AbortLifecycleError && error.name === "AbortLifecycleError";
}

export function useReactComponentLifecycleRender<P, S extends State, O = unknown>(context: LifecycleContext<P, S>): O {
  const nextContext = {};
  const previousState = context.stateContainer.state;
  const nextState = useSetState(context);
  useForceUpdate(context);

  const snapshot = getSnapshot(context);
  const shouldUpdate = getShouldComponentUpdate(context, nextState, nextContext);

  if (shouldUpdate === false) {
    throw new AbortLifecycleError();
  }

  deprecatedWillComponentMount(context, snapshot, nextState, nextContext);
  setStateContainer(context, nextState);

  useUnmount(context);

  const renderResult = context.render.call(context.stateContainer, context.props, nextState);

  componentDidMount(context, previousState, snapshot);

  return renderResult;
}

function componentDidMount<S extends State>(context: LifecycleContext<unknown, S>, previousState: S, snapshot: unknown) {
  context.lifecycle.componentDidMount?.();
  context.lifecycle.componentDidUpdate?.(context.previousProps, previousState, snapshot);
}


function useUnmount(
  {
    dispatcher: {
      useEffect
    },
    lifecycle: {
      componentWillUnmount: unmount
    }
  }: LifecycleContext,
) {
  return useEffect(() => {
    if (!unmount) return;
    return () => {
      unmount();
    };
  }, [unmount]);
}

function setStateContainer<P, S extends State>({ stateContainer, props }: LifecycleContext<P, S>, nextState: S) {
  stateContainer.state = nextState;
  stateContainer.props = props;
}

function useForceUpdate(
  {
    dispatcher: {
      useReducer
    },
    lifecycle
  }: LifecycleContext
) {
  const [, forceUpdate] = useReducer(() => Symbol(), Symbol());
  Object.defineProperty(lifecycle, "forceUpdate", {
    value: forceUpdate
  });
}

function useSetStateInitial<P, S extends State>(context: LifecycleContext<P, S>) {
  const {
    dispatcher: {
      useCallback
    },
    staticLifecycle,
    stateContainer,
  } = context;
  return useCallback((props: P): S => {
    let initialState: S = stateContainer.state;
    if (staticLifecycle.getDerivedStateFromProps) {
      initialState = {
        ...initialState,
        ...staticLifecycle.getDerivedStateFromProps(props, initialState),
      };
    }
    return initialState;
  }, [stateContainer]);
}

function useSetState<P, S extends State>(context: LifecycleContext<P, S>): S {
  const {
    dispatcher: {
      useReducer
    },
    props,
    stateContainer
  } = context;
  const getInitialState = useSetStateInitial(context);
  const [nextState, setState] = useReducer<ReactReducer<S, SetStateAction<S>>, P>(
    (previousState: S, nextStateAction: SetStateAction<S>): S => {
      const nextState = typeof nextStateAction === "function" ? nextStateAction(previousState) : nextStateAction;
      if (!nextState || nextState === previousState) {
        return previousState;
      }
      return {
        ...previousState,
        ...nextState
      };
    },
    props,
    getInitialState
  );
  stateContainer.setState = setState;
  return nextState;
}

function getShouldComponentUpdate<P, S extends State>(
  {
    lifecycle,
    props,
    stateContainer: {
      state
    }
  }: LifecycleContext<P, S>,
  nextState: S,
  nextContext: unknown
) {
  return !lifecycle.shouldComponentUpdate || lifecycle.shouldComponentUpdate(props, nextState, nextContext);
}

export function getSnapshot<P, S extends State>(
  {
    lifecycle,
    previousProps,
    stateContainer: {
      state: previousState
    }
  }: LifecycleContext<P, S>
) {
  return lifecycle.getSnapshotBeforeUpdate?.(previousProps, previousState);
}

function deprecatedWillComponentMount<P, S extends State>(
  {
    staticLifecycle,
    lifecycle,
    props: currentProps,
    previousProps
  }: LifecycleContext<P, S>,
  snapshot: unknown,
  nextState: S,
  nextContext: unknown,
) {
  if (snapshot) return;
  if (staticLifecycle.getDerivedStateFromProps) return;

  lifecycle.componentWillMount?.();
  lifecycle.UNSAFE_componentWillMount?.();

  if (previousProps !== currentProps) {
    lifecycle.componentWillReceiveProps?.(currentProps, nextContext);
    lifecycle.UNSAFE_componentWillReceiveProps?.(currentProps, nextContext);
  }

  lifecycle.componentWillUpdate?.(currentProps, nextState, nextContext);
  lifecycle.UNSAFE_componentWillUpdate?.(currentProps, nextState, nextContext);
}
