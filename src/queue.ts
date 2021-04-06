import { Collector } from "microtask-collector";

export interface DeferredAction {
  (): unknown;
}
export type DeferredActionCollector = Collector<DeferredAction, ReadonlyArray<DeferredAction>>;
export type DeferredActionIterator = AsyncIterator<ReadonlyArray<DeferredAction>>;
export type DeferredActionIteratorResult = IteratorResult<ReadonlyArray<DeferredAction>>;
