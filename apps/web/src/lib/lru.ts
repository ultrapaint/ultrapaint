/**
 * A map that keeps only the `capacity` entries used last: what is read or written goes to the
 * back, and the one at the front makes room when it is full.
 */
export class LruMap<K, V> {
  private readonly entries = new Map<K, V>();
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get size() {
    return this.entries.size;
  }

  has(key: K) {
    return this.entries.has(key);
  }

  get(key: K): V | undefined {
    if (!this.entries.has(key)) {
      return undefined;
    }
    const value = this.entries.get(key) as V;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: K, value: V) {
    this.entries.delete(key);
    this.entries.set(key, value);
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.capacity) {
        break;
      }
      this.entries.delete(oldest);
    }
  }
}
