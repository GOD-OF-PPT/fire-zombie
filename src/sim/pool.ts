/**
 * Deterministic generic object pool that scrubs recycled instances on both
 * acquire and release so zero stale state can ever bleed across runs.
 */
export class EntityPool<T> {
  private readonly freeList: T[] = [];
  private readonly factory: () => T;
  private readonly resetFn: (item: T) => void;

  constructor(initialCapacity: number, factory: () => T, resetFn: (item: T) => void) {
    this.factory = factory;
    this.resetFn = resetFn;
    for (let i = 0; i < initialCapacity; i++) {
      const item = factory();
      resetFn(item);
      this.freeList.push(item);
    }
  }

  acquire(): T {
    const item = this.freeList.pop() ?? this.factory();
    this.resetFn(item);
    return item;
  }

  release(item: T): void {
    this.resetFn(item);
    this.freeList.push(item);
  }

  releaseAll(activeList: T[]): void {
    for (let i = activeList.length - 1; i >= 0; i--) {
      const item = activeList[i];
      if (item !== undefined) {
        this.resetFn(item);
        this.freeList.push(item);
      }
    }
    activeList.length = 0;
  }
}
