import { AbortSignal, CancellableSignal, isAborted, SimpleSignal } from "./cancellable";
import type { ReactVNode } from "./node";
import type { DeferredActionIterator } from "./queue";
import type { State } from "./state";

export interface ControllerOptions {
  signal?: CancellableSignal;
}

export interface RenderOptions {
  iterateUpdateQueue: boolean;
}

export interface RenderMeta {
  currentState: State;
  currentProps: unknown;
  previousState: State;
  previousProps: unknown;
  onError(error: unknown): Promise<boolean> | boolean;
  parent?: ReactVNode;
}

type Tree<T extends object = object> = Map<T, Tree<T>>;

export class Controller implements AbortSignal  {

  readonly #signal: CancellableSignal = new SimpleSignal();
  readonly #iterators: WeakMap<ReactVNode, DeferredActionIterator>;
  readonly #tree: Tree<ReactVNode> = new Map();
  readonly #parents: WeakMap<ReactVNode, Tree<ReactVNode>> = new WeakMap();

  #root: ReactVNode | undefined;

  get aborted() {
    return isAborted(this.#signal);
  }

  constructor(options: ControllerOptions = {}) {
    this.#signal = options.signal ?? this.#signal;
  }

  tryAbort() {
    if (this.#signal instanceof SimpleSignal) {
      this.#signal.abort();
    }
  }

  hello?(node: ReactVNode) {
    if (!this.#root) {
      this.setRoot(node);
    }
  }

  setRoot(node: ReactVNode) {
    this.#root = node;
  }

  async beforeRender?(node: ReactVNode, meta: RenderMeta): Promise<boolean> {
    return true;
  }

  #getRoot = () => {
    if (!this.#root) {
      throw new Error("No root found");
    }
    return this.#root;
  }

  async afterRender?(node: ReactVNode, meta: RenderMeta): Promise<boolean> {
    this.hello?.(node);

    const parent = meta.parent ?? this.#getRoot();
    const parentTree = this.#tree.get(parent) ?? new Map();
    const nodeTree = parentTree.get(node) ?? new Map();
    parentTree.set(node, nodeTree);

    const currentParent = this.#parents.get(node);
    if (currentParent && currentParent !== parentTree) {
      parentTree.delete(node);
    }

    this.#tree.set(parent, parentTree);
    this.#parents.set(node, parentTree);

    return true;
  }

  async beforeDestroyed?(node: ReactVNode): Promise<void> {

  }

  async afterDestroyed?(node: ReactVNode): Promise<void> {

  }


}
