export interface Cancellable {
  readonly cancelled?: unknown;
  readonly requested?: unknown;
  readonly reason?: unknown;
}

export class SimpleCancellable implements Cancellable {

  private isCancelled: boolean = false;

  get requested() {
    return this.isCancelled;
  }

  cancel() {
    this.isCancelled = true;
  }

}

export function isCancelled(cancellable: Cancellable | undefined) {
  return !!(
    cancellable &&
    (
      cancellable.cancelled ||
      cancellable.requested ||
      cancellable.reason
    )
  );
}
