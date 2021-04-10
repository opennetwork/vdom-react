import { DeferredAction, DeferredActionCollector } from "./queue";
import { isPromise } from "iterable";

export interface ProxiedListeners {
  _listeners?: Record<string, (event: Event) => void>;
  _collector?: DeferredActionCollector;
}

export function eventProxy(this: ProxiedListeners, event: Event) {
  scopedEvent.call(this, event, false);
}

export function eventProxyCapture(this: ProxiedListeners, event: Event) {
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
