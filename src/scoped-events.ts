import { DeferredAction, DeferredActionCollector } from "./queue";
import { isPromise } from "iterable";

const LISTENERS = Symbol("Event Listeners");
const LISTENER_ACTIONS = Symbol("Event Listener Action Queue");

export interface ProxiedListeners {
  [LISTENERS]?: Record<string, (event: Event) => void>;
  [LISTENER_ACTIONS]?: DeferredActionCollector;
}

export function initEventProxyActions(documentNode: Element & ProxiedListeners, actions: DeferredActionCollector) {
  documentNode[LISTENER_ACTIONS] = documentNode[LISTENER_ACTIONS] ?? actions;
}

export function initEventProxy(documentNode: Element & ProxiedListeners, name: string, value?: (event: Event) => void, useCapture: boolean = false) {
  const handler = useCapture ? eventProxyCapture : eventProxy;
  if (typeof value === "function") {
    documentNode[LISTENERS] = documentNode[LISTENERS] ?? {};
    documentNode[LISTENERS][name + useCapture] = value;
    documentNode.addEventListener(name, handler, useCapture);
  } else {
    documentNode.removeEventListener(name, handler, useCapture);
  }
}

export function eventProxy(this: ProxiedListeners, event: Event) {
  scopedEvent.call(this, event, false);
}

export function eventProxyCapture(this: ProxiedListeners, event: Event) {
  scopedEvent.call(this, event, true);
}

function scopedEvent(this: ProxiedListeners, event: Event, useCapture: boolean) {
  if (!this[LISTENERS]) {
    return;
  }
  const fn = this[LISTENERS]?.[event.type + useCapture];
  if (typeof fn === "function") {
    try {
      const result = fn(event);
      if (isPromise(result)) {
        const action: DeferredAction & { priority?: number, render?: boolean, event?: boolean } = () => result;
        action.priority = 1;
        action.render = false;
        action.event = true;
        this[LISTENER_ACTIONS]?.add(action);
      }
    } catch (error) {
      if (this[LISTENER_ACTIONS]) {
        this[LISTENER_ACTIONS].add(() => Promise.reject(error));
      } else {
        // Uncaught error!
        throw error;
      }
    }
  }
}
