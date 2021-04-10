import { WorkInProgressHook } from "react-reconciler";

export interface WorkInProgressContext {
  hookIndex: number;
  keyedHooks: Map<unknown, WorkInProgressHook>;
  indexedHooks: Map<unknown, WorkInProgressHook>;
  hooked: boolean;
}

export function createWorkInProgressContext(): WorkInProgressContext {
  return {
    hooked: false,
    hookIndex: -1,
    keyedHooks: new Map(),
    indexedHooks: new Map()
  };
}

export function useWorkInProgress<MemoizedState, Queue = unknown>(context: WorkInProgressContext, key?: unknown, unref?: boolean): WorkInProgressHook<MemoizedState, Queue> {
  if (!unref) {
    context.hooked = true;
  }
  const resolvedKey = key ?? (context.hookIndex += 1);
  const map = resolvedKey === key ? context.keyedHooks : context.indexedHooks;
  const current = map.get(resolvedKey);
  if (isWorkInProgressHook(current)) {
    return current;
  }
  const hook: WorkInProgressHook<MemoizedState, Queue> = {};
  map.set(resolvedKey, hook);
  return hook;

  function isWorkInProgressHook(current: unknown): current is WorkInProgressHook<MemoizedState, Queue> {
    return !!current;
  }

}
