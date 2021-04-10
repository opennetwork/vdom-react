import {
  createVNode,
  Fragment, FragmentVNode, isSourceReference, isVNode, SourceReference,
  SourceReferenceRepresentationFactory,
  VNode
} from "@opennetwork/vnode";
import { NativeAttributes, NativeOptions, NativeOptionsVNode, setAttributes } from "@opennetwork/vdom";
import {
  MutableRefObject,
  ReactElement,
  ReactNode,
  Context as ReactContext,
  Fragment as ReactFragment,
  ComponentClass as ReactComponentClass,
  createRef,
} from "react";
import * as NoNo from "react";
import { isIterable, isPromise } from "iterable";
import { isElement } from "@opennetwork/vdom";
import { Controller, RenderMeta } from "./controller";
import { Deferred, deferred } from "./deferred";
import { isAbortLifecycleError } from "./lifecycle";
import {
  assertFragment,
  assertFunction,
  assertProps,
  assertReactElement, assertSharedInternalsPresent,
  isReactComponent, isReactContextConsumerElement, isReactContextProviderElement, isReactElement,
  isReactForwardRefExoticComponent, isReactForwardRefExoticElement
} from "./type-guards";
import { createReactDispatcher } from "./dispatcher";
import { DeferredAction, DeferredActionCollector } from "./queue";
import { renderComponent } from "./component";
import { Native } from "./native-node";
import { renderFunction } from "./function";

const IS_IN_REACT_TREE = Symbol("This component is part of a react tree");
const CONTEXT = Symbol("Context");
const ERROR_BOUNDARY = Symbol("Error Boundary");
const CONTROLLER = Symbol("Controller");
const PARENT = Symbol("Parent ReactVNode");

export type ErrorBoundarySymbol = typeof ERROR_BOUNDARY;
export interface ContinueFn {
  (): boolean;
}
export type ContinueFlag = ContinueFn | undefined;

const VNODE = Symbol("React VNode");

export type ResolvedReactVNode = FragmentVNode | ReactVNode | NativeOptionsVNode;
export type ReactVNodeChildren = ReadonlyArray<ResolvedReactVNode | (VNode & { native?: unknown })>;

export interface ReactVNode extends VNode {
  [VNODE]: true;
  options: Record<symbol | string, unknown> & {
    setProps(props: object): void;
    updateQueue: DeferredActionCollector,
    readonly stateChanged: boolean;
    readonly parent?: ReactVNode
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

export interface ReactOptions extends Record<string | symbol, unknown> {
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
    __isProps: typeof PROPS_BRAND
  } & Record<string, unknown>;

  let previousProps: Props | undefined = undefined;

  const instance = new Map<ReactComponentClass<Props, unknown>, InstanceType<ReactComponentClass<Props, unknown>>>();

  const dispatcher = createReactDispatcher({
    contextMap: options[CONTEXT]
  });
  const updateQueueIterator = dispatcher.updateQueue[Symbol.asyncIterator]();

  const { source, reference, options: props = {} } = node;

  assertProps<Props>(props);
  assertFunction(source);
  assertFragment(reference);

  let currentProps: Props = props,
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
      updateQueue: dispatcher.updateQueue,
      get stateChanged() {
        return dispatcher.state.symbol !== previousStateChange;
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
    dispatcher.stateChanged();
    while (!destroyed && rendering) await rendering;
    if (!destroyed) {
      await actuallyDestroy();
    }
  }

  async function actuallyDestroy() {
    isDestroyable = true;
    destroyed = true;
    await controller.beforeDestroyed?.(populatedNode);
    await dispatcher.destroyHookEffectList(0);
    await controller.afterDestroyed?.(populatedNode);
    dispatcher.updateQueue.close();
  }

  function setContinueFlag(givenContinueFlag: typeof continueFlag) {
    continueFlag = givenContinueFlag;
  }

  function setProps(props: object) {
    dispatcher.updateQueue.add(setCurrentProps.bind(undefined, props));
  }

  function setCurrentProps(props: object) {
    if (props === currentProps) {
      return;
    }
    assertProps<Props>(props);
    currentProps = props;
    dispatcher.stateChanged();
  }

  async function *renderGenerator(options: ReactOptions, source: () => unknown): AsyncIterable<ReadonlyArray<VNode>> {
    const knownPromiseErrors = new WeakSet<Promise<unknown>>();
    let renderedStateChange = previousStateChange,
      renderedProps = previousProps,
      renderMeta: RenderMeta,
      renderDeferred: Deferred,
      willContinue: boolean = true;

    do {
      dispatcher.beforeRender();

      const renderingProps = currentProps;
      const renderingStateChange = dispatcher.state.symbol;

      renderMeta = {
        parent: options[PARENT],
        onError,
        currentChange: renderingStateChange,
        currentProps,
        previousChange: renderedStateChange,
        previousProps: renderedProps
      };

      if (renderedStateChange !== dispatcher.state.symbol) {
        try {
          if (!await controller.beforeRender?.(populatedNode, renderMeta)) break;
          let renderResult;
          renderDeferred = deferred();
          rendering = renderDeferred.promise;
          try {
            renderResult = await render(options, source, renderingProps);
          } catch (error) {
            if (isAbortLifecycleError(error)) {
              renderResult = undefined;
            } else if (await onError(error)) {
              break;
            }
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
          if (!dispatcher.hooked && !childrenOptions[IS_IN_REACT_TREE]) {
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
            yield Object.freeze([map(dispatcher.updateQueue, { ...childrenOptions, [PARENT]: populatedNode }, latestValue)]);
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
        // This should be only done when we have rendered
        await dispatcher.commitHookEffectList(0);
      }
      willContinue = (continueFlag?.() ?? true);
      if (dispatcher.hooked && (willContinue || options[PARENT])) {
        if (!(await waitForUpdates(!willContinue))) {
          break;
        }
      }
    } while (!isDestroyable && willContinue && (await controller.afterRender?.(populatedNode, renderMeta) ?? true) && dispatcher.hooked && options[CONTROLLER]?.aborted !== true && !caughtError);

    if (caughtError) {
      await actuallyDestroy();
      await Promise.reject(caughtError);
    }

    async function waitForUpdates(detach: boolean): Promise<boolean> {
      const update = async (): Promise<boolean> => {
        const updateQueueIterationResult = await updateQueueIterator.next();
        const results = await Promise.all([
          (updateQueueIterationResult.value ?? []).map(async (fn: DeferredAction) => {
            try {
              await fn();
            } catch (error) {
              if (await renderMeta.onError(error)) {
                return false;
              }
            }
          })
        ]);
        return results.find(value => !value) ?? true;
      };
      const { parent } = renderMeta;
      if (detach) {
        if (parent) {
          parent.options.updateQueue.add(update);
        } else {
          // Do nothing
          return;
        }
      } else if (node === parent) {
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
      if (isAbortLifecycleError(error)) {
        return false;
      } else if (isPromise(error)) {
        const promiseError: Promise<unknown> = error;
        // If we are here, and we know this error, it was already thrown and resolved
        // Else we already know about it and it is in our update queue
        if (!knownPromiseErrors.has(error)) {
          dispatcher.updateQueue.add(() => promiseError);
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

  async function render(options: ReactOptions, source: () => unknown, props: Props): Promise<[unknown, ReactOptions]>  {
    if (isReactComponent<Props, Record<string, unknown>>(source)) {
      return renderComponent({
        options,
        dispatcher,
        previousProps,
        errorBoundarySymbol: ERROR_BOUNDARY,
        node: populatedNode,
        source,
        props,
        instance
      });
    } else {
      const renderResult = await renderFunction(source, dispatcher, props);
      return [renderResult, options];
    }
  }


}

export function map(collector: DeferredActionCollector, options: Partial<ReactOptions>, element: unknown): ResolvedReactVNode {
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
      children: flattenChildren(element.props.children, {
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
    return React(options, { reference: Fragment, source: render, options: props || {} });
  } else if (isReactElement(element)) {
    const { type, props, ref, key }: ReactElement & { ref?: unknown } = element;
    if (type === ReactFragment) {
      return {
        reference: Fragment,
        options: {},
        source: element,
        children: flattenChildren(element.props.children, options)
      };
    } else if (typeof type === "function") {
      return React(options, { reference: Fragment, source: type, options: props || {} });
    } else {
      return Native({
        type,
        props,
        ref: ref,
        children: flattenChildren(props.children, options),
        collector,
        key: key,
      });
    }
  }
  return { reference: Fragment, source: element };

  async function *flattenChildren(children: unknown, options: Partial<ReactOptions>): AsyncIterable<ReadonlyArray<ResolvedReactVNode>> {
    return yield flatten(children);

    function flatten(source: unknown): ResolvedReactVNode[] {
      if (isSourceReference(source)) {
        // Bypass the native layer and make it a text node straight away
        const native: NativeOptionsVNode = {
          reference: Symbol(),
          options: {
            type: "Text"
          },
          source: String(source)
        };
        return [native];
      } else if (Array.isArray(source)) {
        return source.reduce<(FragmentVNode | ReactVNode | NativeOptionsVNode)[]>(
          (nodes, value) => nodes.concat(...flatten(value)),
          []
        );
      } else if (isReactElement(source)) {
        return [map(collector, options, source)];
      }
      return [];
    }

  }

}




