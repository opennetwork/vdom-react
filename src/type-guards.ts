import { SharedInternals } from "react-reconciler";
import {
  Component as ReactComponent,
  ComponentClass as ReactComponentClass,
  Consumer as ReactConsumer,
  Context as ReactContext,
  createContext,
  createElement as createReactElement,
  forwardRef,
  ForwardRefExoticComponent as ReactForwardRefExoticComponent,
  Fragment as ReactFragment,
  MutableRefObject,
  PropsWithoutRef,
  Provider as ReactProvider,
  ProviderExoticComponent,
  ProviderProps,
  ReactElement,
  ReactNode,
  RefAttributes, SetStateAction
} from "react";

const throwAwayContext = createContext(undefined);
const ReactProviderSymbol = throwAwayContext.Provider.$$typeof;
const ReactConsumerSymbol = throwAwayContext.Consumer.$$typeof;
const throwAwayForwardRef = forwardRef(() => createReactElement(ReactFragment));
const ReactForwardRefSymbol = throwAwayForwardRef.$$typeof;

export function assertSharedInternalsPresent(value: unknown): asserts value is {
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

export function isReactElement(value: unknown): value is ReactElement {
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

export function isReactForwardRefExoticElement<T = unknown, P = object>(value: unknown): value is ReactElement<P, ReactForwardRefExoticComponent<PropsWithoutRef<P> & RefAttributes<T>> & { render(props: P, ref: MutableRefObject<unknown>): unknown }> & { ref: MutableRefObject<unknown> } {
  function isReactForwardRefExoticElementLike(value: unknown): value is { type: unknown } {
    return !!value;
  }
  return isReactForwardRefExoticElementLike(value) && isReactForwardRefExoticComponent(value.type);
}

export function isReactForwardRefExoticComponent<T = unknown, P = unknown>(value: unknown): value is ReactForwardRefExoticComponent<PropsWithoutRef<P> & RefAttributes<T>> & { render(props: P, ref: MutableRefObject<unknown>): unknown } {
  function isReactForwardRefExoticComponentLike(value: unknown): value is Partial<ReactForwardRefExoticComponent<PropsWithoutRef<P> & RefAttributes<T>>> & { render: unknown } {
    return !!value;
  }
  return (
    isReactForwardRefExoticComponentLike(value) &&
    value.$$typeof === ReactForwardRefSymbol &&
    typeof value.render === "function"
  );
}

export function isReactContextProviderElement<T = unknown>(value: unknown): value is ReactElement<{ value: T, children?: ReactNode }, ReactProviderWithContext<T>> {
  function isReactContextProviderElementLike(value: unknown): value is { type: unknown } {
    return !!value;
  }
  return isReactContextProviderElementLike(value) && isReactContextProvider(value.type);
}

export interface ReactProviderWithContext<T> extends ReactProvider<T> {
  _context: ReactContext<T>;
}

export function isReactContextProvider<T = unknown>(value: unknown): value is ReactProviderWithContext<T> {
  function isReactContextProviderLike(value: unknown): value is Partial<ProviderExoticComponent<ProviderProps<T>>> {
    return !!value;
  }
  return (
    isReactContextProviderLike(value) &&
    value.$$typeof === ReactProviderSymbol
  );
}

export function isReactContextConsumerElement<T = unknown>(value: unknown): value is ReactElement<{ children(value: T): ReactNode }, ReactConsumerWithContext<T>> {
  function isReactContextConsumerElementLike(value: unknown): value is { type: unknown } {
    return !!value;
  }
  return isReactContextConsumerElementLike(value) && isReactContextConsumer(value.type);
}

export interface ReactConsumerWithContext<T> extends ReactConsumer<T> {
  _context: ReactContext<T>;
}

export function isReactContextConsumer<T = unknown>(value: unknown): value is ReactConsumerWithContext<T> {
  function isReactContextConsumerLike(value: unknown): value is Partial<ProviderExoticComponent<ProviderProps<T>>> {
    return !!value;
  }
  return (
    isReactContextConsumerLike(value) &&
    value.$$typeof === ReactConsumerSymbol
  );
}

export function isReactContext<T = unknown>(value: unknown): value is ReactContext<T> & {
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


export function assertReactElement(value: unknown): asserts value is ReactElement {
  if (!isReactElement(value)) {
    throw new Error("Expected ReactElement");
  }
}

export function isReactComponent<T, S extends object = Record<string, unknown>>(value: unknown): value is ReactComponentClass<T, S> {
  function isPrototypeLike(value: unknown): value is { prototype: unknown } {
    return typeof value === "function";
  }
  return (
    isPrototypeLike(value) &&
    value.prototype instanceof ReactComponent
  );
}

export function isReactErrorBoundaryInstance<P, S>(value: ReactComponent<P, S>): value is InstanceType<ReactComponentClass<P, S>> {
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

export function isSetStateFn<S>(initialState: SetStateAction<S>): initialState is ((state: S) => S) {
  return typeof initialState === "function";
}
