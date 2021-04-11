import { DeferredActionCollector } from "./queue";
import {
  isReactContextConsumerElement,
  isReactContextProviderElement, isReactElement, isReactForwardRefExoticComponent,
  isReactForwardRefExoticElement
} from "./type-guards";
import { Fragment, isSourceReference, VNode } from "@opennetwork/vnode";
import { createRef, Fragment as ReactFragment, ReactElement } from "react";
import type { DOMNativeVNode, NativeOptionsVNode } from "@opennetwork/vdom";
import type { createVNode, Options } from "./node";
import { Native as DOMNative } from "@opennetwork/vdom";
import { Native } from "./native-node";

export interface TransformContext {
  options: Partial<Options>;
  updateQueue: DeferredActionCollector;
  element: unknown;
  createVNode: typeof createVNode;
}

export function transform(context: TransformContext): DOMNativeVNode {
  const node = initialTransform(context);
  return DOMNative(node.options, node);
}

export function initialTransform(context: TransformContext): VNode {
  const {
    element,
    updateQueue,
    createVNode,
    options: {
      contextMap
    }
  } = context;
  if (isReactContextConsumerElement(element)) {
    const foundContext = contextMap?.get(element.type._context);
    const result = element.props.children(foundContext?.currentValue);
    if (result) {
      return initialTransform({
        ...context,
        element: result
      });
    }
  } else if (isReactContextProviderElement(element)) {
    const nextContextMap = new Map(contextMap);
    nextContextMap.set(element.type._context, {
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
        ...context,
        options: {
          ...context.options,
          contextMap: nextContextMap
        }
      })
    };
  } else if (isReactForwardRefExoticElement(element)) {
    const { type, props, ref } = element;
    if (!isReactForwardRefExoticComponent(type)) {
      throw new Error("Expected ref element");
    }
    const { render: source } = type;
    const render = source.bind(undefined, props, ref || createRef());
    return createVNode({}, { reference: Fragment, source: render, options: props || {} });
  } else if (isReactElement(element)) {
    const { type, props, ref, key }: ReactElement & { ref?: unknown } = element;
    if (type === ReactFragment) {
      return {
        reference: Fragment,
        options: {},
        source: element,
        children: flattenChildren(element.props.children, context)
      };
    } else if (typeof type === "function") {
      return createVNode(context.options, { reference: Fragment, source: type, options: props || {} });
    } else {
      return Native({
        type,
        props,
        ref: ref,
        children: flattenChildren(props.children, context),
        collector: updateQueue,
        key: key
      });
    }
  }
  return { reference: Fragment, source: element };

  async function *flattenChildren(children: unknown, context: TransformContext): AsyncIterable<ReadonlyArray<VNode>> {
    return yield flatten(children);

    function flatten(source: unknown): VNode[] {
      if (isSourceReference(source)) {
        // Bypass the native layer and make it a text node straight away
        const native: NativeOptionsVNode = {
          reference: Symbol(),
          options: {
            type: "Text"
          },
          source: String(source)
        };
        return [
          DOMNative(native.options, native)
        ];
      } else if (Array.isArray(source)) {
        return source.reduce<VNode[]>(
          (nodes, value) => nodes.concat(...flatten(value)),
          []
        );
      } else if (isReactElement(source)) {
        return [
          transform({
            ...context,
            element: source
          })
        ];
      }
      return [];
    }

  }

}
