import { expect, test } from "bun:test";
import { levelWithBounds } from "../src/lib/levels";
import {
  leaderboardMember,
  listCard,
  profileCard,
  standingEntry,
} from "../src/lib/member-items";

const card = {
  id: 7,
  username: "wren",
  avatar: null,
  frame: null,
  nameColor: null,
  title: "Member",
  badges: [],
  level: 3,
};

const item = {
  card,
  createdAt: "2026-01-01T00:00:00.000Z",
  postCount: 12,
  reactionScore: 4,
  awardXp: 350,
  credits: 80,
  awardCount: 2,
  referralCount: 1,
};

test("a ranking row is the list item under the names the components use", () => {
  expect(leaderboardMember(item)).toEqual({
    id: 7,
    member: card,
    level: { level: 3 },
    xp: 350,
    credits: 80,
    postCount: 12,
    reactionCount: 4,
    referralCount: 1,
    awards: { length: 2 },
  });
});

test("a list item's card has no level bar and no cover, only the award count", () => {
  const user = listCard(item);
  expect(user.level).toEqual({ level: 3 });
  expect(user.coverPicture).toBeNull();
  expect(user.awards).toEqual([]);
  expect(user.awardCount).toBe(2);
  expect(user.reactionCount).toBe(4);
});

test("a profile's card carries the level bounds the backend gave", () => {
  const user = profileCard(
    {
      id: 7,
      username: "wren",
      createdAt: "2026-01-01T00:00:00.000Z",
      cover: { fileId: 1, url: "/cover.png" },
      card,
      postCount: 12,
      reactionScore: 4,
      awardXp: 350,
      awardSlots: 7,
      level: { level: 3, currentLevelXp: 300, nextLevelXp: 600 },
    } as unknown as Parameters<typeof profileCard>[0],
    [],
  );
  expect(user.coverPicture).toEqual({ url: "/cover.png" });
  expect(user.level).toEqual(levelWithBounds(3, 350, 300, 600));
  expect(user.awardSlots).toEqual({ desktop: 7, mobile: 3 });
});

test("the fill of a level bar stays within its bounds", () => {
  expect(levelWithBounds(2, 150, 100, 300).progress).toBe(0.25);
  expect(levelWithBounds(2, 50, 100, 300).progress).toBe(0);
  expect(levelWithBounds(2, 900, 100, 300).progress).toBe(1);
  expect(levelWithBounds(1, 0, 0, 0).progress).toBe(0);
});

test("a standing entry names its member and keeps the month of a winner", () => {
  const entry = standingEntry({
    card,
    posts: 3,
    reactions: 20,
    referrals: 1,
    points: 25,
    year: 2026,
    month: 9,
  });
  expect(entry.user).toEqual({ id: 7, member: card });
  expect(entry).toMatchObject({ year: 2026, month: 9, points: 25 });
  expect("card" in entry).toBe(false);
});
