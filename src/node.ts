import { Fragment, VNode } from "@opennetwork/vnode";
import { NativeVNode, Native } from "@opennetwork/vdom";
import type { Context as ReactContext, } from "react";
import { assertFragment, assertFunction, assertProps, isReactElement } from "./type-guards";
import type { CreateVNodeFnCatch, CreateRenderContextOptions } from "./context";

export interface ReactContextDescriptor<T = unknown> {
  currentValue: T;
}

export type ReactContextMap = Map<ReactContext<unknown>, ReactContextDescriptor>;

// Compile time type guard
type ThrowAway = CreateVNodeFnCatch<typeof createVNode>;

export function createVNode(node: VNode, options: CreateRenderContextOptions): NativeVNode {

  const PROPS_BRAND = Symbol("This object is branded as this components props");

  if (isReactElement(node.source) && typeof node.source.type === "function") {
    return createVNode(
      {
        reference: Fragment,
        source: node.source.type,
        options: node.source.props
      },
      options
    );
  }

  type Props = {
    __isProps: typeof PROPS_BRAND
  } & Record<string, unknown>;

  const { source, reference, options: props = {} } = node;

  assertProps<Props>(props);
  assertFunction(source);
  assertFragment(reference);

  const renderContext = options.createChildContext(source, props);

  return Native({}, renderContext);
}

