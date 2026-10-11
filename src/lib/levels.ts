export type Level = {
  level: number;
  xp: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progress: number;
};

const STEP = 100;

// Each level costs STEP more XP than the one before: 0, 100, 300, 600, 1000, ...
export function xpForLevel(level: number): number {
  return (STEP * level * (level - 1)) / 2;
}

export function levelForXp(xp: number): Level {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  const currentLevelXp = xpForLevel(level);
  const nextLevelXp = xpForLevel(level + 1);
  return {
    level,
    xp,
    currentLevelXp,
    nextLevelXp,
    progress: (xp - currentLevelXp) / (nextLevelXp - currentLevelXp),
  };
}

const TITLES: [level: number, title: string][] = [
  [4, "Senior member"],
  [2, "Member"],
];

export function titleForLevel(level: number): string {
  return TITLES.find(([from]) => level >= from)?.[1] ?? "New member";
}
