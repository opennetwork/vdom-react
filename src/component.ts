import { Component as ReactComponent, ComponentClass as ReactComponentClass } from "react";
import { useReactComponentLifecycleRender } from "./lifecycle";
import { isReactErrorBoundaryInstance } from "./type-guards";
import { ErrorBoundarySymbol, ReactOptions, ReactVNode } from "./react";
import { Dispatcher } from "./dispatcher";

export interface ComponentContext<P> {
  options: ReactOptions;
  previousProps: P;
  dispatcher: Dispatcher;
  source: ReactComponentClass<P, unknown>;
  props: P;
  instance: WeakMap<ReactComponentClass<P, unknown>, ReactComponent<P, unknown>>;
  node: ReactVNode;
  errorBoundarySymbol: ErrorBoundarySymbol;
}

export async function renderComponent<P>(context: ComponentContext<P>): Promise<[unknown, ReactOptions] | undefined>  {
  const {
    instance,
    source,
    props,
    options,
    node,
    dispatcher,
    previousProps
  } = context;
  const currentInstance = instance.get(source);
  if (!currentInstance) {
    const newInstance = new source(props);
    instance.set(source, newInstance);
    return renderComponent(context);
  }

  const renderResult = useReactComponentLifecycleRender({
    node,
    dispatcher,
    previousProps,
    stateContainer: currentInstance,
    staticLifecycle: source,
    props,
    lifecycle: currentInstance,
    render: currentInstance.render,
  });

  const childrenOptions: ReactOptions = {
    ...options
  };

  const errorBoundary = useErrorBoundary(context, currentInstance);
  if (isReactErrorBoundaryInstance(currentInstance) || source.getDerivedStateFromError) {
    childrenOptions[context.errorBoundarySymbol] = errorBoundary;
  }

  return [renderResult, childrenOptions];
}

function useErrorBoundary<S, P>(context: ComponentContext<P>, instance: ReactComponent<P, unknown>) {
  const {
    source,
    dispatcher,
  } = context;
  return dispatcher.useCallback((error: unknown): boolean => {
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
