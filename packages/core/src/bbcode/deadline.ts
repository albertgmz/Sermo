import { ValidationError } from "../errors";

/** Render work one message may take (parse, build, HTML and sanitize; database lookups excluded). */
export const RENDER_LIMIT_MS = 50;

export const TOO_COMPLEX = "This message is too complex.";

export function tooComplex(): ValidationError {
  return new ValidationError(TOO_COMPLEX, [{ path: ["body"], message: TOO_COMPLEX }]);
}

const CHECK_EVERY = 64;

/**
 * A cooperative time bound: the renderer calls `tick()` once per token or node and the clock is
 * read every few ticks, so work past the limit stops with the "too complex" ValidationError. It
 * is the safety net; the renderer itself does linear work. `pause()` and `resume()` leave out the
 * time spent in database lookups between the stages.
 */
export class Deadline {
  private spent = 0;
  private since: number | null = null;
  private ticks = 0;

  constructor(
    private readonly limitMs: number = RENDER_LIMIT_MS,
    private readonly now: () => number = () => performance.now(),
  ) {}

  resume(): void {
    this.since ??= this.now();
  }

  pause(): void {
    if (this.since === null) return;
    this.spent += this.now() - this.since;
    this.since = null;
  }

  tick(): void {
    if (++this.ticks % CHECK_EVERY === 0) this.check();
  }

  check(): void {
    const running = this.since === null ? 0 : this.now() - this.since;
    if (this.spent + running > this.limitMs) throw tooComplex();
  }
}
