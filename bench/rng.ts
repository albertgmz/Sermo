/** Small deterministic PRNG utilities for the seed generator and benchmarks. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** mulberry32: uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Pareto-distributed value >= 1 with shape `alpha`, capped at `max`. */
  pareto(alpha: number, max: number): number {
    const v = 1 / (1 - this.next()) ** (1 / alpha);
    return Math.min(max, v);
  }
}

/** Samples indexes 0..n-1 with Zipf-like weights 1/(i+1)^s using a precomputed CDF. */
export class ZipfSampler {
  private readonly cdf: Float64Array;

  constructor(n: number, s: number) {
    this.cdf = new Float64Array(n);
    let total = 0;
    for (let i = 0; i < n; i++) {
      total += 1 / (i + 1) ** s;
      this.cdf[i] = total;
    }
    for (let i = 0; i < n; i++) this.cdf[i]! /= total;
  }

  sample(rng: Rng): number {
    const u = rng.next();
    let lo = 0;
    let hi = this.cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.cdf[mid]! < u) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}
