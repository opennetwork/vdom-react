import { deferred } from "./deferred";

export interface State<Value = void> {
  readonly promise: Promise<void>;
  readonly symbol: symbol;
  readonly value: Value;
  change(value: Value): void;
}

export function createState<Value = void>(initialValue: Value = undefined): State<Value> {
  let defer = deferred();
  let symbol = Symbol();
  let value = initialValue;
  return {
    get promise() {
      return defer.promise;
    },
    get symbol() {
      return symbol;
    },
    get value() {
      return value;
    },
    change(nextValue: Value) {
      value = nextValue;
      symbol = Symbol();
      defer.resolve();
      defer = deferred();
    }
  };
}
