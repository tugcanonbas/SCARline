interface Flight<T> {
  readonly promise: Promise<T>;
}

export class SingleFlightCache<T> {
  readonly #flights = new Map<string, Flight<T>>();
  readonly #reuseWindowMilliseconds: number;

  constructor(reuseWindowMilliseconds: number) {
    this.#reuseWindowMilliseconds = reuseWindowMilliseconds;
  }

  run(key: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.#flights.get(key);
    if (existing !== undefined) return existing.promise;

    const promise = operation();
    const flight = { promise };
    this.#flights.set(key, flight);
    const scheduleRemoval = () => {
      const timer = setTimeout(() => {
        if (this.#flights.get(key) === flight) this.#flights.delete(key);
      }, this.#reuseWindowMilliseconds);
      timer.unref?.();
    };
    void promise.then(scheduleRemoval, scheduleRemoval);
    return promise;
  }
}
