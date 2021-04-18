import { Collector } from "microtask-collector";

export interface DeferredAction {
  (): unknown;
}
export type DeferredActionCollector = {
  add(action: DeferredAction): void
};
export type DeferredActionIterator = AsyncIterator<DeferredAction[]>;
export type DeferredActionIteratorResult = IteratorResult<DeferredAction[]>;
