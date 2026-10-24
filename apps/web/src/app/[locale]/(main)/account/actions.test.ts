import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";

const realFetch = globalThis.fetch;

// What the actions wrote to the visitor's cookies: ["set", name, value, options] or ["delete", name].
const cookieWrites: unknown[][] = [];
mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({ ...nextCache, revalidatePath: () => {} }));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    set: (...args: unknown[]) => cookieWrites.push(["set", ...args]),
    delete: (name: string) => cookieWrites.push(["delete", name]),
  }),
}));

const {
  removePicture,
  saveAppearance,
  saveProfile,
  savePreferences,
  savePrivacy,
  stopIgnoring,
  stopWatchingForum,
  stopWatchingThread,
} = await import("./actions");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
afterEach(() => {
  globalThis.fetch = realFetch;
  cookieWrites.length = 0;
});

const generic = messages.lib.errors.generic;

const card = {
  id: 1,
  username: "ember",
  avatar: null,
  frame: null,
  nameColor: null,
  nameIcon: null,
  title: "Member",
  badges: [],
  restricted: false,
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
      nameIconItemId: null,
      available: {
        accents: [],
        nameColors: [],
        frames: [],
        nameIcons: [],
        covers: [],
      },
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
    isAdult: false,
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

test("a birthday blanked in all three fields is cleared", async () => {
  const asked = backend();
  const saved = await saveProfile(
    "birthday",
    form({ day: "", month: "", year: "" }),
  );
  expect(saved).toEqual({ ok: true });
  expect(asked[0].method).toBe("PATCH");
  expect(asked[0].body).toEqual({ birthday: null });
});

test("a date with a day and a month is sent as typed, the year when given", async () => {
  const asked = backend();
  await saveProfile("birthday", form({ day: "31", month: "2", year: "" }));
  expect(asked[0].body).toEqual({ birthday: { day: 31, month: 2 } });
  await saveProfile("birthday", form({ day: "3", month: "12", year: "1990" }));
  expect(asked[1].body).toEqual({
    birthday: { day: 3, month: 12, year: 1990 },
  });
});

test("a birthday the backend refuses shows the backend's words", async () => {
  backend(refusal("Pick a real date.", 400));
  expect(
    await saveProfile("birthday", form({ day: "31", month: "2", year: "" })),
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
      await saveProfile("birthday", form(birthday)),
      JSON.stringify(birthday),
    ).toEqual({ error: messages.account.errors.birthdayIncomplete });
  }
  expect(asked).toEqual([]);
});

test("each row of the profile saves only its own field", async () => {
  const asked = backend();
  await saveProfile("about", form({ about: " Hello " }));
  await saveProfile("location", form({ location: "Lisbon" }));
  await saveProfile("website", form({ website: "" }));
  await saveProfile("telegram", form({ telegram: "ember" }));
  await saveProfile("customTitle", form({ customTitle: " Captain " }));
  await saveProfile("signature", form({ signature: "**bye**" }));
  expect(asked.map((entry) => entry.body)).toEqual([
    { about: " Hello " },
    { location: "Lisbon" },
    { website: "" },
    { socials: { telegram: "ember" } },
    { customTitle: "Captain" },
    { signature: "**bye**" },
  ]);
});

test("emptying a title or a signature clears it", async () => {
  const asked = backend();
  expect(await saveProfile("customTitle", form({ customTitle: "  " }))).toEqual(
    { ok: true },
  );
  await saveProfile("signature", form({ signature: "" }));
  expect(asked.map((entry) => entry.body)).toEqual([
    { customTitle: null },
    { signature: null },
  ]);
});

test("a refused profile field answers the backend's words and nothing redirects", async () => {
  backend(refusal("A custom title needs a perk.", 403));
  expect(
    await saveProfile("customTitle", form({ customTitle: "Captain" })),
  ).toEqual({ error: "A custom title needs a perk." });
});

test("a part that is not a field of the profile does nothing and says so generically", async () => {
  const asked = backend();
  for (const part of ["credits", "__proto__", "", undefined, "level"]) {
    expect(
      await saveProfile(part as "about", form({ about: "x" })),
      String(part),
    ).toEqual({ error: generic });
  }
  expect(asked).toEqual([]);
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
});

test("removing a picture answers in place, with the backend's words when it refuses", async () => {
  const asked = backend();
  expect(await removePicture("avatar")).toEqual({ ok: true });
  expect(asked[0]).toMatchObject({ path: "/api/v1/profile/avatar" });
  expect(asked[0].body).toEqual({ fileId: null });
  expect(await removePicture("cover")).toEqual({ ok: true });
  expect(asked[1]).toMatchObject({ path: "/api/v1/profile/cover" });

  backend(refusal("Nothing to remove."));
  expect(await removePicture("cover")).toEqual({ error: "Nothing to remove." });
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
    expect(await removePicture(kind as "avatar"), String(kind)).toEqual({
      error: generic,
    });
  }
  expect(asked).toEqual([]);
});

test("an appearance choice is a known field and a plain record id, or empty to take it off", async () => {
  const asked = backend();
  for (const field of ["fontSize", "__proto__", "constructor", "", undefined]) {
    expect(
      await saveAppearance(field as "accent", form({ value: "3" })),
      String(field),
    ).toEqual({ error: generic });
  }
  for (const value of ["abc", "-3", "0", "1e2", "0x10", " 7", "3.5", "7 "]) {
    expect(await saveAppearance("frame", form({ value })), value).toEqual({
      error: generic,
    });
  }
  expect(asked).toEqual([]);

  expect(await saveAppearance("frame", form({ value: "5" }))).toEqual({
    ok: true,
  });
  expect(asked[0]).toMatchObject({ method: "PUT", path: "/api/v1/appearance" });
  expect(asked[0].body).toEqual({ frameId: 5 });
  await saveAppearance("nameColor", form({ value: "" }));
  expect(asked[1].body).toEqual({ nameColorId: null });
  await saveAppearance("nameIcon", form({ value: "9" }));
  expect(asked[2].body).toEqual({ nameIconItemId: 9 });
  await saveAppearance("nameIcon", form({ value: "" }));
  expect(asked[3].body).toEqual({ nameIconItemId: null });
});

test("an appearance choice the backend refuses answers its words, so the row shows them", async () => {
  backend(refusal("You do not own that frame.", 403));
  expect(await saveAppearance("frame", form({ value: "5" }))).toEqual({
    error: "You do not own that frame.",
  });
});

const PREFERENCES = {
  watchOnCreate: "none",
  watchOnReply: "none",
  language: null,
  profileViewPrivacy: "everyone",
  profilePostPrivacy: "members",
  keyboardShortcuts: true,
  homeTab: null,
  feedView: "cards",
  theme: null,
  showOnline: true,
};
const preferenceForm = (language: string) =>
  form({ watchOnCreate: "none", watchOnReply: "none", language });

test("saving a language sets the language cookie, and the redirect lands in the new language", async () => {
  const asked = backend(() =>
    Response.json({ ...PREFERENCES, language: "es" }),
  );
  const to = await redirectedTo(() =>
    savePreferences(null as never, preferenceForm("es")),
  );
  expect(asked[0].body).toMatchObject({ language: "es" });
  expect(cookieWrites).toHaveLength(1);
  const [verb, name, value, options] = cookieWrites[0] as [
    string,
    string,
    string,
    object,
  ];
  expect([verb, name, value]).toEqual(["set", "forum_locale", "es"]);
  expect(options).toMatchObject({
    path: "/",
    httpOnly: false,
    sameSite: "lax",
  });
  expect(to?.pathname).toBe("/account/preferences");
});

test("choosing the default language deletes the cookie", async () => {
  const asked = backend(() => Response.json(PREFERENCES));
  await redirectedTo(() => savePreferences(null as never, preferenceForm("")));
  expect(asked[0].body).toMatchObject({ language: null });
  expect(cookieWrites).toEqual([["delete", "forum_locale"]]);
});

test("a refused save leaves the language cookie alone", async () => {
  backend(refusal("Unsupported language.", 400));
  const state = await savePreferences(null as never, preferenceForm("xx"));
  expect(state).toEqual({ error: "Unsupported language." });
  expect(cookieWrites).toEqual([]);
});

test("the keyboard shortcuts box is sent as a yes when ticked and a no when left out of the form", async () => {
  const asked = backend(() => Response.json(PREFERENCES));
  const send = (shortcuts?: string) =>
    redirectedTo(() =>
      savePreferences(
        null as never,
        form({
          watchOnCreate: "none",
          watchOnReply: "none",
          language: "",
          ...(shortcuts === undefined ? {} : { keyboardShortcuts: shortcuts }),
        }),
      ),
    );
  await send("on");
  await send();
  expect(asked.map((call) => call.body)).toMatchObject([
    { keyboardShortcuts: true },
    { keyboardShortcuts: false },
  ]);
});

test("the online status box is sent as a yes when ticked and a no when left out of the form", async () => {
  const asked = backend(() => Response.json(PREFERENCES));
  const send = (showOnline?: string) =>
    redirectedTo(() =>
      savePrivacy(
        null as never,
        form({
          profileViewPrivacy: "everyone",
          profilePostPrivacy: "members",
          ...(showOnline === undefined ? {} : { showOnline }),
        }),
      ),
    );
  expect((await send("on"))?.pathname).toBe("/account/privacy");
  await send();
  expect(asked.map((call) => call.body)).toEqual([
    {
      profileViewPrivacy: "everyone",
      profilePostPrivacy: "members",
      showOnline: true,
    },
    {
      profileViewPrivacy: "everyone",
      profilePostPrivacy: "members",
      showOnline: false,
    },
  ]);
});

test("the home tab choice is sent as a tab, and the site default as null", async () => {
  const asked = backend(() => Response.json(PREFERENCES));
  const send = (homeTab: string) =>
    redirectedTo(() =>
      savePreferences(
        null as never,
        form({
          watchOnCreate: "none",
          watchOnReply: "none",
          language: "",
          homeTab,
        }),
      ),
    );
  await send("media");
  await send("");
  expect(asked.map((call) => call.body)).toMatchObject([
    { homeTab: "media" },
    { homeTab: null },
  ]);
});

test("the language cookie is Secure on an https site", async () => {
  const before = process.env.SERMO_PUBLIC_URL;
  process.env.SERMO_PUBLIC_URL = "https://forum.example.test";
  try {
    backend(() => Response.json({ ...PREFERENCES, language: "es" }));
    await redirectedTo(() =>
      savePreferences(null as never, preferenceForm("es")),
    );
    expect(cookieWrites[0]?.[3]).toMatchObject({ secure: true });
  } finally {
    if (before === undefined) delete process.env.SERMO_PUBLIC_URL;
    else process.env.SERMO_PUBLIC_URL = before;
  }
});
