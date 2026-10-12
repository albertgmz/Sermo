import messages from "../../messages/en/lib.json";

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

const TITLES: [level: number, key: keyof typeof messages.levels][] = [
  [4, "seniorMember"],
  [2, "member"],
];

export function titleKeyForLevel(level: number): keyof typeof messages.levels {
  return TITLES.find(([from]) => level >= from)?.[1] ?? "newMember";
}

// English compatibility for UserView.title until its renderers use the key.
export function titleForLevel(level: number): string {
  return messages.levels[titleKeyForLevel(level)];
}
