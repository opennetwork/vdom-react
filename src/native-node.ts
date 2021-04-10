import { MutableRefObject, ReactElement } from "react";
import { getDocumentNode, isElement, NativeAttributes, NativeOptionsVNode, setAttributes } from "@opennetwork/vdom";
import { DeferredActionCollector } from "./queue";
import { eventProxy, eventProxyCapture, ProxiedListeners } from "./scoped-events";
import { VNode } from "@opennetwork/vnode";
import { DOMNativeVNodeInstance } from "@opennetwork/vdom/src/options";

export interface NativeElement extends ReactElement {
  ref?: unknown;
  type: string;
  collector: DeferredActionCollector;
  children: AsyncIterable<ReadonlyArray<VNode>>;
}

export function Native(element: NativeElement): NativeOptionsVNode {
  const { key, type: source, children } = element;
  const node: NativeOptionsVNode = {
    source,
    reference: key || Symbol("React"),
    options: {
      type: "Element"
    },
    children
  };
  node.options.onBeforeRender = onBeforeRender.bind(undefined, element, node);
  return node;
}

async function onBeforeRender(context: NativeElement, node: NativeOptionsVNode, documentNode: Element & ProxiedListeners | Text) {
  const { collector, props, ref } = context;

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
      } else if (typeof DOMTokenList !== "undefined" && value instanceof DOMTokenList) {
        documentNode.className = value.value;
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
