import {
  Fragment,
  FragmentVNode,
  VNode
} from "@opennetwork/vnode";
import { DOMNativeVNode, NativeOptionsVNode } from "@opennetwork/vdom";
import type {
  Context as ReactContext,
  ComponentClass as ReactComponentClass,
} from "react";
import { Controller } from "./controller";
import {
  assertFragment,
  assertFunction,
  assertProps,
  isReactElement,
} from "./type-guards";
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

export type ResolvedReactVNode = FragmentVNode | ReactVNode | DOMNativeVNode;
export type ReactVNodeChildren = ReadonlyArray<DOMNativeVNode>;

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

export function createVNode(options: Partial<ReactOptions>, node: VNode): ReactVNode {
  const PROPS_BRAND = Symbol("This object is branded as this components props");

  if (!isReactOptions(options)) {
    return createVNode(
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

  let currentProps: Props = props,
    previousState = createState(),
    isDestroyable = false,
    destroyed = false,
    continueFlag: () => boolean | undefined = () => false;

  setCurrentProps(props);

  const controller = options[CONTROLLER];
  let renderContext: RenderContext<Props>;
  const populatedNode: ReactVNode = {
    [VNODE]: true,
    reference: Fragment,
    options: {
      setProps,
      setContinueFlag,
      updateQueue: dispatcher.updateQueue,
      get stateChanged() {
        return dispatcher.state.symbol !== previousState.symbol;
      },
      get parent() {
        return options[PARENT];
      },
      destroy
    },
    children: {
      async *[Symbol.asyncIterator]() {
        yield *renderGenerator(renderContext, options, source);
      }
    }
  };
  renderContext = {
    dispatcher,
    destroy: actuallyDestroy,
    node: populatedNode,
    createVNode,
    get isDestroyable() {
      return isDestroyable;
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
    get currentProps() {
      return currentProps;
    },
    set currentProps(value) {
      currentProps = value;
    },
    get continueFlag() {
      return continueFlag;
    },
    get previousState() {
      return previousState;
    },
    set previousState(value) {
      previousState = value;
    },
    get currentState() {
      return dispatcher.state;
    },
    contextSymbol: CONTEXT,
    parentSymbol: PARENT
  };
  controller.hello?.(populatedNode);
  return populatedNode;

  async function destroy() {
    isDestroyable = true;
    if (destroyed) return;
    // Push an update where it will see that the component is destroyed
    dispatcher.state.change();
    while (!destroyed && renderContext.rendering) await renderContext.rendering;
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
    dispatcher.state.change();
  }




}





