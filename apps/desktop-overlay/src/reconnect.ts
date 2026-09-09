export class ReconnectScheduler {
  readonly #connect: () => void;
  readonly #delayMilliseconds: number;
  readonly #setTimer: (callback: () => void, delayMilliseconds: number) => ReturnType<typeof setTimeout>;
  readonly #clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: {
    connect: () => void;
    delayMilliseconds?: number;
    setTimer?: typeof setTimeout;
    clearTimer?: typeof clearTimeout;
  }) {
    this.#connect = options.connect;
    this.#delayMilliseconds = options.delayMilliseconds ?? 1_500;
    this.#setTimer = options.setTimer ?? setTimeout;
    this.#clearTimer = options.clearTimer ?? clearTimeout;
  }

  get pending(): boolean {
    return this.#timer !== undefined;
  }

  schedule(): void {
    if (this.#timer !== undefined) return;
    this.#timer = this.#setTimer(() => {
      this.#timer = undefined;
      this.#connect();
    }, this.#delayMilliseconds);
  }

  cancel(): void {
    if (this.#timer === undefined) return;
    this.#clearTimer(this.#timer);
    this.#timer = undefined;
  }
}
