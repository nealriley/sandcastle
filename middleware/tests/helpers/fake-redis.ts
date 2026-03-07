type ValueEntry = {
  value: unknown;
  expiresAt: number | null;
};

type SortedSetEntry = {
  members: Map<string, number>;
  expiresAt: number | null;
};

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

export class FakeRedis {
  private values = new Map<string, ValueEntry>();
  private sortedSets = new Map<string, SortedSetEntry>();

  reset() {
    this.values.clear();
    this.sortedSets.clear();
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.getValueEntry(key);
    return entry ? cloneValue(entry.value as T) : null;
  }

  async set(
    key: string,
    value: unknown,
    options?: { ex?: number; nx?: boolean }
  ): Promise<"OK" | null> {
    if (options?.nx && this.getValueEntry(key)) {
      return null;
    }

    this.values.set(key, {
      value: cloneValue(value),
      expiresAt: this.resolveExpiry(options?.ex),
    });
    return "OK";
  }

  async getdel<T>(key: string): Promise<T | null> {
    const entry = this.getValueEntry(key);
    this.values.delete(key);
    return entry ? cloneValue(entry.value as T) : null;
  }

  async incr(key: string): Promise<number> {
    const entry = this.getValueEntry(key);
    const nextValue = Number(entry?.value ?? 0) + 1;

    this.values.set(key, {
      value: nextValue,
      expiresAt: entry?.expiresAt ?? null,
    });

    return nextValue;
  }

  async del(key: string): Promise<number> {
    let deleted = 0;

    if (this.values.delete(key)) {
      deleted += 1;
    }
    if (this.sortedSets.delete(key)) {
      deleted += 1;
    }

    return deleted;
  }

  async zadd(
    key: string,
    input: { score: number; member: string }
  ): Promise<0 | 1> {
    const entry = this.getSortedSetEntry(key) ?? {
      members: new Map<string, number>(),
      expiresAt: null,
    };
    const existed = entry.members.has(input.member);

    entry.members.set(input.member, input.score);
    this.sortedSets.set(key, entry);

    return existed ? 0 : 1;
  }

  async zrange<T = string[]>(
    key: string,
    start: number,
    stop: number,
    options?: { rev?: boolean }
  ): Promise<T> {
    const entry = this.getSortedSetEntry(key);
    if (!entry) {
      return [] as T;
    }

    const members = [...entry.members.entries()]
      .sort((left, right) => {
        if (options?.rev) {
          return right[1] - left[1];
        }
        return left[1] - right[1];
      })
      .map(([member]) => member);

    const normalizedStop =
      stop < 0 ? members.length + stop : Math.min(stop, members.length - 1);

    if (normalizedStop < start) {
      return [] as T;
    }

    return members.slice(start, normalizedStop + 1) as T;
  }

  async expire(key: string, seconds: number): Promise<0 | 1> {
    const expiresAt = this.resolveExpiry(seconds);
    const valueEntry = this.getValueEntry(key);
    if (valueEntry) {
      valueEntry.expiresAt = expiresAt;
      this.values.set(key, valueEntry);
      return 1;
    }

    const setEntry = this.getSortedSetEntry(key);
    if (setEntry) {
      setEntry.expiresAt = expiresAt;
      this.sortedSets.set(key, setEntry);
      return 1;
    }

    return 0;
  }

  private resolveExpiry(seconds?: number): number | null {
    return seconds ? Date.now() + seconds * 1000 : null;
  }

  private getValueEntry(key: string): ValueEntry | null {
    const entry = this.values.get(key) ?? null;
    if (!entry) {
      return null;
    }

    if (this.isExpired(entry.expiresAt)) {
      this.values.delete(key);
      return null;
    }

    return entry;
  }

  private getSortedSetEntry(key: string): SortedSetEntry | null {
    const entry = this.sortedSets.get(key) ?? null;
    if (!entry) {
      return null;
    }

    if (this.isExpired(entry.expiresAt)) {
      this.sortedSets.delete(key);
      return null;
    }

    return entry;
  }

  private isExpired(expiresAt: number | null): boolean {
    return expiresAt != null && expiresAt <= Date.now();
  }
}
