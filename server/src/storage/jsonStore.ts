// ============================================================================
// Small helpers that give repositories a document/collection view over a
// StorageProvider, with serialized read-modify-write so concurrent requests
// (e.g. debounced submission saves) can't clobber each other. This mirrors how
// you'd use optimistic concurrency / leases against Azure Blob Storage.
// ============================================================================
import type { StorageProvider } from './storageProvider.js';

/** Chains async operations so they run one at a time. */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const mutexes = new Map<string, Mutex>();
function mutexFor(key: string): Mutex {
  let m = mutexes.get(key);
  if (!m) {
    m = new Mutex();
    mutexes.set(key, m);
  }
  return m;
}

/** An array-shaped JSON document (one row per element). */
export class JsonCollection<T> {
  constructor(
    private provider: StorageProvider,
    private collection: string,
    private name: string,
  ) {}

  private get lockKey(): string {
    return `${this.collection}/${this.name}`;
  }

  async all(): Promise<T[]> {
    return (await this.provider.readJson<T[]>(this.collection, this.name)) ?? [];
  }

  /** Serialized read → transform → write. Returns the transform's result. */
  mutate<R>(fn: (items: T[]) => { next: T[]; result: R }): Promise<R> {
    return mutexFor(this.lockKey).run(async () => {
      const items = await this.all();
      const { next, result } = fn(items);
      await this.provider.writeJson(this.collection, this.name, next);
      return result;
    });
  }
}

/** A single JSON document (object-shaped), with a fallback when unset. */
export class JsonDocument<T> {
  constructor(
    private provider: StorageProvider,
    private collection: string,
    private name: string,
    private fallback: T,
  ) {}

  private get lockKey(): string {
    return `${this.collection}/${this.name}`;
  }

  async get(): Promise<T> {
    const stored = await this.provider.readJson<T>(this.collection, this.name);
    return stored ?? this.fallback;
  }

  async set(value: T): Promise<void> {
    await this.provider.writeJson(this.collection, this.name, value);
  }

  /** Serialized read → transform → write. */
  mutate<R>(fn: (current: T) => { next: T; result: R }): Promise<R> {
    return mutexFor(this.lockKey).run(async () => {
      const current = await this.get();
      const { next, result } = fn(current);
      await this.provider.writeJson(this.collection, this.name, next);
      return result;
    });
  }
}
