export interface AbortSignal {
  readonly aborted: boolean;
}

export interface CancellableSignal extends Partial<AbortSignal> {
  readonly cancelled?: unknown;
  readonly requested?: unknown;
  readonly reason?: unknown;
}

export class SimpleSignal implements AbortSignal {

  private isAborted: boolean = false;

  get aborted() {
    return this.isAborted;
  }

  abort() {
    this.isAborted = true;
  }

}

export function isAborted(cancellable?: CancellableSignal) {
  return !!(
    cancellable &&
    (
      cancellable.cancelled ||
      cancellable.requested ||
      cancellable.reason ||
      cancellable.aborted
    )
  );
}
