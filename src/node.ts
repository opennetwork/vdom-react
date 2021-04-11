import { Fragment, VNode } from "@opennetwork/vnode";
import { DOMNativeVNode, Native } from "@opennetwork/vdom";
import type { ComponentClass as ReactComponentClass, Context as ReactContext, } from "react";
import { Controller } from "./controller";
import { assertFragment, assertFunction, assertProps, isReactElement } from "./type-guards";
import { createReactDispatcher } from "./dispatcher";
import { RenderContext, renderGenerator } from "./render";
import { createState } from "./state";

export interface ReactContextDescriptor<T = unknown> {
  currentValue: T;
}

export type ReactContextMap = Map<ReactContext<unknown>, ReactContextDescriptor>;

export interface Options extends Record<string | symbol, unknown> {
  controller?: Controller;
  contextMap: ReactContextMap;
  // Returns false if error should be ignored, or true to throw it further
  errorBoundary(error: unknown): boolean;
  parent?: RenderContext;
}

export function isOptions(options: Partial<Options>): options is Options {
  return !!(options.contextMap && options.errorBoundary);
}

export function createVNode(options: Partial<Options>, node: VNode): DOMNativeVNode {
  const PROPS_BRAND = Symbol("This object is branded as this components props");

  if (!isOptions(options)) {
    const completeOptions: Options = {
      contextMap: new Map(),
      errorBoundary: () => true,
      ...options
    };
    return createVNode(
      completeOptions,
      node
    );
  }

  if (isReactElement(node.source) && typeof node.source.type === "function") {
    return createVNode(
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

  const { source, reference, options: props = {} } = node;

  assertProps<Props>(props);
  assertFunction(source);
  assertFragment(reference);

  let previousProps: Props | undefined = undefined;
  const instance = new Map<ReactComponentClass<Props, unknown>, InstanceType<ReactComponentClass<Props, unknown>>>();
  const dispatcher = createReactDispatcher({
    contextMap: options.contextMap
  });
  const updateQueueIterator = dispatcher.updateQueue[Symbol.asyncIterator]();

  let isDestroyable = false,
    destroyed = false;

  const controller = options.controller;
  const renderContext: RenderContext<Props> = {
    dispatcher,
    options,
    source,
    destroy: actuallyDestroy,
    createVNode,
    previousState: createState(),
    get isDestroyable() {
      return isDestroyable;
    },
    get destroyed() {
      return destroyed;
    },
    instance,
    updateQueueIterator,
    get previousProps() {
      return previousProps;
    },
    set previousProps(value) {
      previousProps = value;
    },
    rendering: undefined,
    parent: options.parent,
    controller: options.controller,
    currentProps: undefined,
    continueFlag: undefined,
    get currentState() {
      return dispatcher.state;
    }
  };
  let latestChildren: DOMNativeVNode[] | undefined = undefined;
  const native = Native(
    {
      source
    },
    {
      reference: Fragment,
      children: {
        async *[Symbol.asyncIterator]() {
          if (isDestroyable || destroyed) {
            return;
          }
          let yielded = false;
          for await (const nextChildren of renderGenerator(renderContext)) {
            latestChildren = nextChildren;
            yield nextChildren;
            yielded = true;
          }
          if (!yielded && latestChildren) {
            yield latestChildren;
          }
        }
      }
    }
  );
  controller?.hello?.(renderContext, native);
  return native;

  async function actuallyDestroy() {
    isDestroyable = true;
    destroyed = true;
    await controller.beforeDestroyed?.(renderContext);
    await dispatcher.destroyHookEffectList(0);
    await controller.afterDestroyed?.(renderContext);
    dispatcher.updateQueue.close();
  }
}





