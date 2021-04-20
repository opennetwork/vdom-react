import { MutableRefObject, ReactElement } from "react";
import {
  NativeVNode,
  isElement,
  NativeAttributes,
  NativeOptionsVNode,
  setAttributes
} from "@opennetwork/vdom";
import { DeferredActionCollector } from "./queue";
import {
  eventProxy,
  eventProxyCapture,
  initEventProxy,
  initEventProxyActions,
  ProxiedListeners
} from "./scoped-events";
import { VNode } from "@opennetwork/vnode";
import { Native as DOMNative } from "@opennetwork/vdom";

export interface NativeElement extends ReactElement {
  ref?: unknown;
  type: string;
  actions: DeferredActionCollector;
  children: AsyncIterable<ReadonlyArray<VNode>>;
}

export function Native(element: NativeElement): NativeVNode {
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
  return DOMNative(node.options, node);
}

const KNOWN_STYLES = Symbol("Known Styles");

export interface PreviousStyles {
  [KNOWN_STYLES]?: unknown;
}

function updateStyles(documentNode: Element & PreviousStyles, nextStyles: unknown) {

  const previousStyles = documentNode[KNOWN_STYLES];

  if (!isElementStyleable(documentNode)) {
    return;
  }

  const nextStylesRecord = isStylesRecord(nextStyles) ? nextStyles : undefined;
  const nextStylesString = typeof nextStyles === "string" ? nextStyles : undefined;
  const previousStylesRecord = isStylesRecord(previousStyles) ? previousStyles : undefined;
  const previousStylesString = typeof previousStyles === "string" ? previousStyles : undefined;

  if (nextStylesRecord) {
    if (previousStylesString) {
      documentNode.style.cssText = "";
      documentNode[KNOWN_STYLES] = undefined;
    } else if (previousStylesRecord && nextStylesRecord) {
      for (const key in previousStylesRecord) {
        if (previousStylesRecord.hasOwnProperty(key) && key in nextStylesRecord) {
          documentNode.style[key] = "";
        }
      }
      documentNode[KNOWN_STYLES] = undefined;
    }
    for (const key in nextStylesRecord) {
      if (nextStylesRecord.hasOwnProperty(key)) {
        documentNode.style[key] = nextStylesRecord[key];
      }
    }
  } else {
    documentNode.style.cssText = nextStylesString ?? "";
  }
  documentNode[KNOWN_STYLES] = nextStyles;

  function isStylesRecord(styles: unknown): styles is object & Record<string, unknown> {
    return typeof styles === "object";
  }

}

function isElementStyleable<T extends Element>(element: T): element is T & (HTMLElement | SVGElement) {
  function isElementCSSInlineStyleLike(element: unknown): element is { style: unknown } {
    return !!element;
  }
  return isElementCSSInlineStyleLike(element) && !!element.style;
}

async function onBeforeRender(context: NativeElement, node: NativeOptionsVNode, documentNode: Element & ProxiedListeners & PreviousStyles | Text) {
  const { actions, props, ref } = context;

  if (!isElement(documentNode)) return;
  initEventProxyActions(documentNode, actions);

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
      updateStyles(documentNode, value);
      continue;
    } else if (key.startsWith("on")) {
      const keyWithoutCapture = key.replace(/Capture$/, "");
      const useCapture = keyWithoutCapture !== key;
      let name = keyWithoutCapture;
      if (name.toLowerCase() in documentNode) {
        name = name.toLowerCase();
      }
      name = name.slice(2);
      initEventProxy(documentNode, name, value, useCapture);
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
