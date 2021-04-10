import { Collector } from "microtask-collector";

export interface DeferredAction {
  (): unknown;
}
export type DeferredActionCollector = Collector<DeferredAction>;
export type DeferredActionIterator = AsyncIterator<DeferredAction[]>;
export type DeferredActionIteratorResult = IteratorResult<DeferredAction[]>;
