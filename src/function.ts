import * as NoNo from "react";
import { assertSharedInternalsPresent } from "./type-guards";
import { ReactDispatcher } from "react-reconciler";

assertSharedInternalsPresent(NoNo);
const { __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: SharedInternals } = NoNo;

export async function renderFunction<P>(source: (props: P) => unknown, dispatcher: ReactDispatcher, props: P): Promise<unknown> {
  SharedInternals.ReactCurrentDispatcher.current = dispatcher;
  const returnedValue = source(props);
  SharedInternals.ReactCurrentOwner.current = undefined;
  SharedInternals.ReactCurrentDispatcher.current = undefined;
  return returnedValue;
}
