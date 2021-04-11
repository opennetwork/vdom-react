import { Fragment, FragmentVNode, VNode } from "@opennetwork/vnode";
import { DOMNativeVNode, Native } from "@opennetwork/vdom";
import type { ComponentClass as ReactComponentClass, Context as ReactContext, } from "react";
import { Controller } from "./controller";
import { assertFragment, assertFunction, assertProps, isReactElement, } from "./type-guards";
import { createReactDispatcher } from "./dispatcher";
import { DeferredActionCollector } from "./queue";
import { RenderContext, renderGenerator } from "./render";
import { createState } from "./state";

const IS_IN_REACT_TREE = Symbol("This component is part of a react tree");
const CONTEXT = Symbol("Context");
const ERROR_BOUNDARY = Symbol("Error Boundary");
const CONTROLLER = Symbol("Controller");
const PARENT = Symbol("Parent ReactVNode");

export type ErrorBoundarySymbol = typeof ERROR_BOUNDARY;
export type ContextSymbol = typeof CONTEXT;
export type ParentSymbol = typeof PARENT;

export interface ContinueFn {
  (): boolean;
}
export type ContinueFlag = ContinueFn | undefined;

const VNODE = Symbol("React VNode");

// export interface ReactVNode extends VNode {
//   [VNODE]: true;
//   options: Record<symbol | string, unknown> & {
//     setProps(props: object): void;
//     updateQueue: DeferredActionCollector,
//     readonly stateChanged: boolean;
//     readonly parent?: ReactVNode
//     destroy(): Promise<void>;
//     setContinueFlag(continueFlag: ContinueFlag): void
//   };
//   children: AsyncIterable<ReactVNodeChildren>;
// }

export interface ReactContextDescriptor<T = unknown> {
  currentValue: T;
}

export type ReactContextMap = Map<ReactContext<unknown>, ReactContextDescriptor>;

export interface Options extends Record<string | symbol, unknown> {
  [CONTROLLER]?: Controller;
  [CONTEXT]: ReactContextMap;
  [ERROR_BOUNDARY](error: unknown): boolean;
  [PARENT]?: RenderContext;
}

export function isOptions(options: Partial<Options>): options is Options {
  return !!(options[CONTEXT] && options[ERROR_BOUNDARY]);
}

export function createVNode(options: Partial<Options>, node: VNode): DOMNativeVNode {
  const PROPS_BRAND = Symbol("This object is branded as this components props");

  if (!isOptions(options)) {
    const completeOptions: Options = {
      [CONTEXT]: new Map(),
      [ERROR_BOUNDARY]: (error) => {
        throw error;
      },
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

  let isDestroyable = false,
    destroyed = false;

  const controller = options[CONTROLLER];
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
    errorBoundarySymbol: ERROR_BOUNDARY,
    rendering: undefined,
    parent: options[PARENT],
    controller: options[CONTROLLER],
    currentProps: undefined,
    continueFlag: undefined,
    get currentState() {
      return dispatcher.state;
    },
    contextSymbol: CONTEXT,
    parentSymbol: PARENT
  };
  controller?.hello?.(renderContext);
  return Native(
  {},
  {
    reference: Fragment,
    children: {
      async *[Symbol.asyncIterator]() {
        if (isDestroyable || destroyed) {
          return;
        }
        yield *renderGenerator(renderContext);
      }
    }
  });

  async function actuallyDestroy() {
    isDestroyable = true;
    destroyed = true;
    await controller.beforeDestroyed?.(renderContext);
    await dispatcher.destroyHookEffectList(0);
    await controller.afterDestroyed?.(renderContext);
    dispatcher.updateQueue.close();
  }
}





