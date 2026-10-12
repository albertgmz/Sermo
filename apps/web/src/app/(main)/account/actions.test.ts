import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) => translator(namespace),
}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({ ...nextCache, revalidatePath: () => {} }));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const {
  clearBirthday,
  removePicture,
  saveAbout,
  saveAppearance,
  stopIgnoring,
  stopWatchingForum,
  stopWatchingThread,
} = await import("./actions");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const generic = messages.lib.errors.generic;

const card = {
  id: 1,
  username: "ember",
  avatar: null,
  frame: null,
  nameColor: null,
  title: "Member",
  badges: [],
  level: 1,
};

// What the backend answers to each write these actions make, in the shape of its contracts.
function succeeded(method: string, path: string): unknown {
  if (method === "DELETE") return { ok: true };
  if (path === "/api/v1/appearance") {
    return {
      accentId: null,
      nameColorId: null,
      frameId: null,
      coverPresetId: null,
      available: { accents: [], nameColors: [], frames: [], covers: [] },
    };
  }
  if (path.startsWith("/api/v1/profile/")) return null;
  return {
    id: 1,
    username: "ember",
    groupTitle: "Members",
    displayGroup: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    about: "",
    avatar: null,
    cover: null,
    postCount: 0,
    reactionScore: 0,
    canPostOnWall: false,
    card,
    customTitle: null,
    signatureHtml: null,
    location: "",
    website: "",
    birthday: null,
    socials: { discord: "", telegram: "", x: "" },
    followerCount: 0,
    followingCount: 0,
    credits: 0,
    awardXp: 0,
    level: { level: 1, currentLevelXp: 0, nextLevelXp: 100 },
    awardSlots: 0,
    referralCount: 0,
    lastActivityAt: null,
    viewer: { isFollowing: false, isIgnoring: false },
  };
}

function backend(response?: () => Response) {
  const asked: { method: string; path: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const method = String(init.method);
    const path = new URL(url).pathname;
    asked.push({
      method,
      path,
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    return response ? response() : Response.json(succeeded(method, path));
  }) as unknown as typeof fetch;
  return asked;
}

function refusal(message: string, status = 409) {
  return () =>
    Response.json({ error: { code: "conflict", message } }, { status });
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

// Where an action sent the visitor, as a URL, or null when it did not redirect.
async function redirectedTo(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    const digest = String((error as { digest?: unknown }).digest);
    const location = digest.split(";")[2];
    return location ? new URL(location, "http://site") : null;
  }
  return null;
}

const about = {
  about: "Hello",
  location: "Lisbon",
  website: "",
  discord: "",
  telegram: "",
  x: "",
};

test("a birthday blanked in all three fields is cleared", async () => {
  const asked = backend();
  const to = await redirectedTo(() =>
    saveAbout(null, form({ ...about, day: "", month: "", year: "" })),
  );
  expect(asked[0].method).toBe("PATCH");
  expect(asked[0].body).toMatchObject({ birthday: null });
  expect(to?.search).toBe("?notice=about");
});

test("a date with a day and a month is sent as typed, the year when given", async () => {
  const asked = backend();
  await redirectedTo(() =>
    saveAbout(null, form({ ...about, day: "31", month: "2", year: "" })),
  );
  expect(asked[0].body).toMatchObject({ birthday: { day: 31, month: 2 } });
  expect(asked[0].body).not.toHaveProperty("birthday.year");
  await redirectedTo(() =>
    saveAbout(null, form({ ...about, day: "3", month: "12", year: "1990" })),
  );
  expect(asked[1].body).toMatchObject({
    birthday: { day: 3, month: 12, year: 1990 },
  });
});

test("a birthday the backend refuses shows the backend's words", async () => {
  backend(refusal("Pick a real date.", 400));
  expect(
    await saveAbout(null, form({ ...about, day: "31", month: "2", year: "" })),
  ).toEqual({ error: "Pick a real date." });
});

test("a year with no day or month, or a day that is not a number, is not sent", async () => {
  const asked = backend();
  const fields = [
    { day: "", month: "", year: "1990" },
    { day: "4", month: "", year: "" },
    { day: "", month: "5", year: "" },
    { day: "x", month: "5", year: "" },
    { day: "4", month: "5", year: "19x" },
  ];
  for (const birthday of fields) {
    expect(
      await saveAbout(null, form({ ...about, ...birthday })),
      JSON.stringify(birthday),
    ).toEqual({ error: messages.account.errors.birthdayIncomplete });
  }
  expect(asked).toEqual([]);
});

test("clearing the birthday is its own action and saving the form never reads a clear field", async () => {
  const asked = backend();
  const to = await redirectedTo(clearBirthday);
  expect(asked[0].body).toEqual({ birthday: null });
  expect(to?.search).toBe("?notice=birthdayRemoved");
  // A form that posts `clear=birthday` (as the old button did) still only saves what it carries.
  await redirectedTo(() =>
    saveAbout(
      null,
      form({ ...about, day: "3", month: "4", year: "", clear: "birthday" }),
    ),
  );
  expect(asked[1].body).toMatchObject({ birthday: { day: 3, month: 4 } });
});

test("a refusal of a button comes back to its own section with the backend's words", async () => {
  backend(refusal("You do not ignore that member."));
  const to = await redirectedTo(() => stopIgnoring(7));
  expect(to?.pathname).toBe("/account/privacy");
  expect(to?.searchParams.get("notice")).toBe("failed");
  expect(to?.searchParams.get("where")).toBe("ignored");
  expect(to?.searchParams.get("message")).toBe(
    "You do not ignore that member.",
  );

  backend(refusal("Not watching."));
  const thread = await redirectedTo(() => stopWatchingThread(3));
  expect(thread?.searchParams.get("where")).toBe("threads");
  expect(thread?.searchParams.get("message")).toBe("Not watching.");
  const forum = await redirectedTo(() => stopWatchingForum(3));
  expect(forum?.searchParams.get("where")).toBe("forums");

  backend(refusal("Nothing to remove."));
  const picture = await redirectedTo(() => removePicture("cover"));
  expect(picture?.pathname).toBe("/account");
  expect(picture?.searchParams.get("where")).toBe("cover");
  expect(picture?.searchParams.get("message")).toBe("Nothing to remove.");
});

test("a button that worked says so in its section", async () => {
  const asked = backend();
  expect((await redirectedTo(() => stopIgnoring(7)))?.search).toBe(
    "?notice=unignored",
  );
  expect(asked[0]).toMatchObject({
    method: "DELETE",
    path: "/api/v1/users/7/ignore",
  });
  const removed = await redirectedTo(() => removePicture("avatar"));
  expect(removed?.search).toBe("?notice=avatarRemoved");
  expect(asked[1]).toMatchObject({ path: "/api/v1/profile/avatar" });
  expect(asked[1].body).toEqual({ fileId: null });
});

test("a bound argument that is not what the page binds does nothing and says so generically", async () => {
  const asked = backend();
  const ids = [0, -1, 1.5, Number.NaN, "7", null, undefined, 2 ** 60];
  for (const id of ids) {
    for (const press of [stopIgnoring, stopWatchingThread, stopWatchingForum]) {
      const to = await redirectedTo(() => press(id as number));
      expect(to?.searchParams.get("notice"), `${press.name} ${id}`).toBe(
        "failed",
      );
      expect(to?.searchParams.get("message")).toBe(generic);
    }
  }
  for (const kind of ["banner", "", "Avatar", undefined, "attachment"]) {
    const to = await redirectedTo(() => removePicture(kind as "avatar"));
    expect(to?.searchParams.get("message"), String(kind)).toBe(generic);
    expect(to?.searchParams.get("where")).toBe("pictures");
  }
  expect(asked).toEqual([]);
});

test("an appearance choice is a known field and a plain record id, or empty to take it off", async () => {
  const asked = backend();
  for (const field of ["fontSize", "__proto__", "constructor", "", undefined]) {
    expect(
      await saveAppearance(field as "accent", null, form({ value: "3" })),
      String(field),
    ).toEqual({ error: generic });
  }
  for (const value of ["abc", "-3", "0", "1e2", "0x10", " 7", "3.5", "7 "]) {
    expect(await saveAppearance("frame", null, form({ value })), value).toEqual(
      { error: generic },
    );
  }
  expect(asked).toEqual([]);

  const worn = await redirectedTo(() =>
    saveAppearance("frame", null, form({ value: "5" })),
  );
  expect(asked[0]).toMatchObject({ method: "PUT", path: "/api/v1/appearance" });
  expect(asked[0].body).toEqual({ frameId: 5 });
  expect(worn?.pathname).toBe("/account/appearance");
  await redirectedTo(() =>
    saveAppearance("nameColor", null, form({ value: "" })),
  );
  expect(asked[1].body).toEqual({ nameColorId: null });
});
