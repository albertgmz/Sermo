/**
 * Levels come from award XP. Level n starts at `step * n * (n - 1) / 2`: level 1 at 0, level 2
 * at `step`, level 3 at `3 * step`, and so on, so each level costs `step` more than the last.
 */
export interface LevelInfo {
  level: number;
  /** XP at which this level starts. */
  currentLevelXp: number;
  /** XP at which the next level starts. */
  nextLevelXp: number;
}

const startOf = (level: bigint, step: bigint) => (step * level * (level - 1n)) / 2n;

/** The level of `xp` under `step`, in constant time (a closed form, then an exact correction). */
export function levelFor(xp: number, step: number): LevelInfo {
  const stepN = BigInt(Math.max(1, Math.floor(step)));
  const xpN = BigInt(Math.max(0, Math.floor(xp)));
  const units = Number(xpN / stepN);
  let level = BigInt(Math.max(1, Math.floor((1 + Math.sqrt(1 + 8 * units)) / 2)));
  while (level > 1n && startOf(level, stepN) > xpN) level -= 1n;
  while (startOf(level + 1n, stepN) <= xpN) level += 1n;
  return {
    level: Number(level),
    currentLevelXp: Number(startOf(level, stepN)),
    nextLevelXp: Number(startOf(level + 1n, stepN)),
  };
}

/** The title of the entry with the highest level not above `level`, or "" when none applies. */
export function levelTitle(level: number, titles: readonly { level: number; title: string }[]) {
  let best: { level: number; title: string } | null = null;
  for (const entry of titles)
    if (entry.level <= level && (!best || entry.level > best.level)) best = entry;
  return best?.title ?? "";
}
