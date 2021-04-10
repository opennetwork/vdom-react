import {
  createVNode,
  Fragment, isSourceReference, isVNode, SourceReference,
  SourceReferenceRepresentationFactory,
  VNode
} from "@opennetwork/vnode";
import { NativeAttributes, NativeOptionsVNode, setAttributes } from "@opennetwork/vdom";
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
  assertReactElement, assertSharedInternalsPresent,
  isReactComponent, isReactContextConsumerElement, isReactContextProviderElement, isReactElement,
  isReactForwardRefExoticComponent, isReactForwardRefExoticElement
} from "./type-guards";
import { createReactDispatcher } from "./dispatcher";
import { DeferredAction, DeferredActionCollector } from "./queue";
import { renderComponent } from "./component";

const IS_IN_REACT_TREE = Symbol("This component is part of a react tree");
const CONTEXT = Symbol("Context");
const ERROR_BOUNDARY = Symbol("Error Boundary");
const CONTROLLER = Symbol("Controller");
const PARENT = Symbol("Parent ReactVNode");
export type ErrorBoundarySymbol = typeof ERROR_BOUNDARY;

export type ReactVNodeChildren = ReadonlyArray<NativeOptionsVNode | VNode & { native?: unknown }>;
export interface ContinueFn {
  (): boolean;
}
export type ContinueFlag = ContinueFn | undefined;

const VNODE = Symbol("React VNode");

export interface ReactVNode extends VNode {
  [VNODE]: true;
  options: Record<symbol | string, unknown> & {
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

  assertSharedInternalsPresent(NoNo);
  const { __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: SharedInternals } = NoNo;

  let previousProps: Props | undefined = undefined;

  const instance = new Map<ReactComponentClass<Props, unknown>, InstanceType<ReactComponentClass<Props, unknown>>>();

  const dispatcher = createReactDispatcher({
    contextMap: options[CONTEXT]
  });
  const updateQueueIterator = dispatcher.updateQueue[Symbol.asyncIterator]();

  const { source, reference, options: props = {} } = node;

  assertProps(props);
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
    assertProps(props);
    currentProps = props;
    dispatcher.stateChanged();
  }

  async function *renderGenerator(options: ReactOptions, source: SourceReferenceRepresentationFactory<Props>): AsyncIterable<ReadonlyArray<VNode>> {
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

    async function waitForUpdates(detatch: boolean): Promise<boolean> {
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
      if (node === parent || !parent) {
        return await update();
      } else if (detatch) {
        parent.options.updateQueue.add(update);
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

  async function render(options: ReactOptions, source: SourceReferenceRepresentationFactory<Props>, props: Props): Promise<[unknown, ReactOptions]>  {
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
      const renderResult = await renderFunction(source, props);
      return [renderResult, options];
    }
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
    SharedInternals.ReactCurrentDispatcher.current = dispatcher;
    const returnedValue = source(props, { reference: Fragment, children: node.children } );
    SharedInternals.ReactCurrentOwner.current = undefined;
    SharedInternals.ReactCurrentDispatcher.current = undefined;
    return returnedValue;
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
  _collector?: DeferredActionCollector;
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
    try {
      const result = fn(event);
      if (isPromise(result)) {
        const action: DeferredAction & { priority?: number, render?: boolean } = () => result;
        action.priority = 1;
        action.render = false;
        this._collector?.add(action);
      }
    } catch (error) {
      if (this._collector) {
        this._collector.add(() => Promise.reject(error));
      } else {
        // Uncaught error!
        throw error;
      }
    }
  }
}


