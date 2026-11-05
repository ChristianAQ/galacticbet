interface Entry {
  value?: unknown;
  expires: number;
  pending?: Promise<unknown>;
}
export function createMemoryCache(limit = 20) {
  const entries = new Map<string, Entry>();
  function peek<T>(key: string): T | undefined {
    const entry = entries.get(key);
    return entry && entry.expires > Date.now() ? (entry.value as T) : undefined;
  }
  function read<T>(
    key: string,
    load: () => Promise<T>,
    ttl: number,
  ): Promise<T> {
    const cached = peek<T>(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const prior = entries.get(key);
    if (prior?.pending) return prior.pending as Promise<T>;
    const entry: Entry = { expires: 0 };
    const pending = Promise.resolve()
      .then(load)
      .then(
        (value) => {
          if (entries.get(key) === entry) {
            entry.value = value;
            entry.expires = Date.now() + ttl;
            entry.pending = undefined;
          }
          return value;
        },
        (error) => {
          if (entries.get(key) === entry) entries.delete(key);
          throw error;
        },
      );
    entry.pending = pending;
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > limit) entries.delete(entries.keys().next().value!);
    return pending;
  }
  return {
    peek,
    read,
    /** Expire matching entries only, keeping unrelated cached reads. */
    drop(match: (key: string) => boolean) {
      for (const key of [...entries.keys()])
        if (match(key)) entries.delete(key);
    },
    clear() {
      entries.clear();
    },
  };
}
export const privateCache = createMemoryCache();
