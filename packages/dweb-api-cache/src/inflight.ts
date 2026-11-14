type RunningLookup = {
  promise: Promise<unknown>;
  startedAt: number;
  // whoever started it, the trace id for requests
  startedBy: string;
};

/**
 * Lets callers that ask for the same key at the same time share one lookup.
 *
 * Without this, every request that misses the cache starts its own lookup,
 * so a name that isn't cached yet (or whose entry just expired) costs one
 * rpc round trip per concurrent request instead of one in total.
 *
 * The first caller runs the lookup and gets its result as is. Callers that
 * join get their own copy, the same as a hit in the memory cache, which
 * clones on get.
 *
 * If the lookup fails, the caller that started it gets the error, like
 * before. The ones that joined try once more, together: one more lookup in
 * total, not one each. Without sharing every request had its own attempt,
 * so a single failed attempt (a dropped connection, one bad response) only
 * failed the request that made it, and it shouldn't take everyone who
 * happened to join down with it. If the second attempt fails too, the
 * backend is most likely down and they all get that error. There's no
 * second attempt after a lookup that failed slowly (see below).
 *
 * A lookup older than maxJoinMs isn't joined anymore, the next caller starts
 * a new one. A normal lookup is done long before that, so one that is still
 * running is probably stuck on a slow backend, and requests arriving later
 * shouldn't all wait on it.
 */
export class InflightLookups {
  private readonly running = new Map<string, RunningLookup>();

  constructor(
    private readonly maxJoinMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  // Who started the lookup that run(key) would join, undefined if run(key)
  // would start a new one.
  joinable(key: string): { startedBy: string } | undefined {
    const running = this.joinableLookup(key);
    return running && { startedBy: running.startedBy };
  }

  run<T>(key: string, startedBy: string, lookup: () => Promise<T>): Promise<T> {
    return this.runOrJoin(key, startedBy, lookup, true);
  }

  get size(): number {
    return this.running.size;
  }

  private runOrJoin<T>(
    key: string,
    startedBy: string,
    lookup: () => Promise<T>,
    retryIfItFails: boolean,
  ): Promise<T> {
    const running = this.joinableLookup(key);
    if (!running) {
      return this.start(key, startedBy, lookup);
    }

    return running.promise.then(
      // Whatever gets cached has to survive the JSON round trip through
      // redis, so it's plain data, which structuredClone handles.
      (value) => structuredClone(value) as T,
      (error) => {
        // A failure that came back quickly is worth one more try. One that
        // took maxJoinMs or longer was most likely a timeout, and another
        // attempt would only double how long these requests take to fail.
        if (
          !retryIfItFails ||
          this.now() - running.startedAt >= this.maxJoinMs
        ) {
          throw error;
        }
        // The first one to get here starts the second attempt, the others
        // find it running and join it, this time without another retry.
        // start() has usually dropped the failed one already, its callback
        // was registered first, but this shouldn't depend on that order.
        this.forget(key, running);
        return this.runOrJoin(key, startedBy, lookup, false);
      },
    );
  }

  private start<T>(
    key: string,
    startedBy: string,
    lookup: () => Promise<T>,
  ): Promise<T> {
    // async wrapper so a lookup that throws synchronously still ends up as
    // a rejected promise and gets removed below
    const promise = (async () => lookup())();
    const entry: RunningLookup = {
      promise,
      startedAt: this.now(),
      startedBy,
    };
    this.running.set(key, entry);

    const forget = () => this.forget(key, entry);
    promise.then(forget, forget);

    return promise;
  }

  private joinableLookup(key: string): RunningLookup | undefined {
    const running = this.running.get(key);
    if (running && this.now() - running.startedAt < this.maxJoinMs) {
      return running;
    }
    return undefined;
  }

  // A newer lookup may have replaced this one in the meantime (after
  // maxJoinMs), don't remove that one.
  private forget(key: string, entry: RunningLookup) {
    if (this.running.get(key) === entry) {
      this.running.delete(key);
    }
  }
}
