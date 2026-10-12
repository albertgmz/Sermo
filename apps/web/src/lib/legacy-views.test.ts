import assert from "node:assert/strict";
import { test } from "node:test";
import seed from "../../data/seed.json";
import { FRAMES } from "./frames";
import { frameView, memberView, prefixView } from "./legacy-views";
import type { Database, Rank, User } from "./types";

const { users, ranks, prefixes } = seed as unknown as Database;

function member(patch: Partial<User>): User {
  const base = users.find((u) => u.role === "member") as User;
  return {
    ...base,
    ...patch,
    appearance: { ...base.appearance, ...patch.appearance },
  };
}

const noAppearance = {
  accent: null,
  nameColor: null,
  frame: null,
  cover: null,
};
const gold = ranks.find((r) => r.headline.nameColor === "gold") as Rank;

test("a member with a frame, a picked colour, a rank and the donor flag", () => {
  const frame = Object.keys(FRAMES)[0];
  const [width, left, top, scale] = FRAMES[frame];
  const view = memberView(
    member({
      id: 7,
      username: "Tobi",
      avatar: "/avatars/tobi.jpg",
      donor: true,
      appearance: { ...noAppearance, nameColor: "lime", frame },
    }),
    "Veteran",
    12,
    gold,
  );
  assert.equal(view.id, 7);
  assert.equal(view.username, "Tobi");
  assert.deepEqual(view.avatar, {
    url: "/avatars/tobi.jpg",
    smallUrl: "/avatars/tobi.jpg",
  });
  assert.deepEqual(view.frame, {
    url: `/frames/${frame}.png`,
    placement: { width, left, top, scale },
  });
  assert.equal(view.nameColor, "#a3e635");
  assert.equal(view.title, "Veteran");
  assert.equal(view.level, 12);
  assert.deepEqual(view.badges, [
    { label: gold.name, color: "#eab308", style: "outline" },
    { label: "Donor", color: "#fb7185", style: "heart" },
  ]);
});

test("an administrator with no picked colour takes the staff colour", () => {
  const admin = memberView(
    member({ role: "admin", appearance: noAppearance }),
    "Admin",
    1,
    null,
  );
  assert.equal(admin.nameColor, "#dc2626");
  assert.deepEqual(admin.badges, [
    { label: "Admin", color: "#dc2626", style: "solid" },
  ]);
  const moderator = memberView(
    member({ role: "moderator", appearance: noAppearance }),
    "Moderator",
    1,
    null,
  );
  assert.equal(moderator.nameColor, "#2dd4bf");
  assert.deepEqual(moderator.badges, [
    { label: "Mod", color: "#2dd4bf", style: "tint" },
  ]);
});

test("a picked colour wins over the staff colour", () => {
  const view = memberView(
    member({
      role: "admin",
      appearance: { ...noAppearance, nameColor: "pink" },
    }),
    "Admin",
    1,
    null,
  );
  assert.equal(view.nameColor, "#f472b6");
});

test("a member with nothing has no picture, frame, colour or badge", () => {
  const view = memberView(
    member({ avatar: "", donor: false, appearance: noAppearance }),
    "New member",
    1,
    null,
  );
  assert.equal(view.avatar, null);
  assert.equal(view.frame, null);
  assert.equal(view.nameColor, null);
  assert.deepEqual(view.badges, []);
});

test("an unknown frame key draws no frame", () => {
  assert.equal(frameView("no-such-frame"), null);
  assert.equal(frameView("toString"), null);
  assert.equal(frameView(null), null);
  const view = memberView(
    member({ appearance: { ...noAppearance, frame: "no-such-frame" } }),
    "New member",
    1,
    null,
  );
  assert.equal(view.frame, null);
});

test("prefixes carry a hex colour and keep their icon", () => {
  for (const prefix of prefixes) {
    const view = prefixView(prefix);
    assert.match(view.color, /^#[0-9a-f]{6}$/);
    assert.equal(view.label, prefix.label);
    assert.equal(view.icon, prefix.icon);
    assert.equal(view.id, prefix.id);
  }
  const sky = prefixes.find((p) => p.color === "sky");
  assert.equal(sky && prefixView(sky).color, "#60a5fa");
});

test("every seeded member adapts and every frame in use has a placement", () => {
  for (const user of users) {
    const view = memberView(user, user.username, 1, null);
    assert.equal(view.frame === null, !user.appearance.frame);
  }
});
