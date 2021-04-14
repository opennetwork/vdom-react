import type { Component as ReactComponent, ComponentClass as ReactComponentClass } from "react";
import { useReactComponentLifecycleRender } from "./lifecycle";
import { isReactErrorBoundaryInstance } from "./type-guards";
import type { RenderContext, RenderContextOptions } from "./context";

export type ComponentInstanceMap<P> = WeakMap<ReactComponentClass<P, unknown>, ReactComponent<P, unknown>>;

export async function renderComponent<P>(context: RenderContext<P>, source: ReactComponentClass<P, unknown>): Promise<[unknown, RenderContextOptions] | undefined>  {
  const {
    instance,
    currentProps: props,
    options,
    dispatcher,
    previousProps
  } = context;
  const currentInstance = instance.get(source);
  if (!currentInstance) {
    const newInstance = new source(props);
    instance.set(source, newInstance);
    return renderComponent(context, source);
  }

  const renderResult = useReactComponentLifecycleRender({
    dispatcher,
    previousProps,
    stateContainer: currentInstance,
    staticLifecycle: source,
    props,
    lifecycle: currentInstance,
    render: currentInstance.render,
  });

  const childrenOptions: RenderContextOptions = {
    ...options
  };

  const errorBoundary = useErrorBoundary(context, currentInstance, source);
  if (isReactErrorBoundaryInstance(currentInstance) || source.getDerivedStateFromError) {
    childrenOptions.errorBoundary = errorBoundary;
  }

  return [renderResult, childrenOptions];
}

function useErrorBoundary<S, P>(context: RenderContext<P>, instance: ReactComponent<P, unknown>, source: ReactComponentClass<P, unknown>) {
  const {
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
