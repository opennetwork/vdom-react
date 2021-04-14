import { deferred } from "./deferred";
import { Collector } from "microtask-collector";

export interface StateContainer<Value = void> {
  readonly symbol: symbol;
  readonly value: Value;
}

// Wrap the result as a tuple so that it isn't resolved automatically
export type NeverEndingPromise = Promise<[NeverEndingPromise]>;

export interface State<Value = void> extends StateContainer<Value>, AsyncIterable<symbol> {
  readonly promise: NeverEndingPromise;
  readonly container: StateContainer<Value>;
  change(value: Value): void;
}
let globalStateIndex = -1;

export function createState<Value = void>(initialValue: Value = undefined, stateChanges?: Collector<State<Value>>): State<Value> {
  let defer = deferred<[NeverEndingPromise]>();
  let symbol = Symbol(globalStateIndex);
  let value = initialValue;
  const state = {
    get promise() {
      return defer.promise;
    },
    get symbol() {
      return symbol;
    },
    get value() {
      return value;
    },
    get container() {
      return {
        symbol,
        value
      };
    },
    change(nextValue: Value) {
      value = nextValue;
      symbol = Symbol(globalStateIndex += 1);
      const nextDefer = deferred<[NeverEndingPromise]>();
      defer.resolve([nextDefer.promise]);
      defer = nextDefer;
      stateChanges?.add(state);
    },
    async *[Symbol.asyncIterator]() {
      let yielded;
      let nextPromise: NeverEndingPromise;
      do {
        if (symbol !== yielded) {
          yielded = symbol;
          yield symbol;
        }
        [nextPromise] = await defer.promise;
      } while (true);
    }
  };
  return state;
}
