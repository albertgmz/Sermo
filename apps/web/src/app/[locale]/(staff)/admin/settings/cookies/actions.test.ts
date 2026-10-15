import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { fakeBackend, refusal } from "../../groups/test-backend";
import { settingsForm } from "../test-form";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
const cacheModule = await import("next/cache");
const expired: string[] = [];
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/cache", () => ({
  ...cacheModule,
  updateTag: (tag: string) => {
    expired.push(tag);
  },
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { askEveryoneAgain, saveCookies } = await import("./actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => {
  backend?.restore();
  expired.length = 0;
});
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => cacheModule);
});

async function redirectedTo(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return String((error as { digest?: unknown }).digest);
  }
  return undefined;
}

// The settings the backend answers a write with: only what the contract has no default for.
const echo = () =>
  Response.json({
    maxUploadBytes: 1000,
    allowedUploadTypes: {
      attachment: [],
      avatar: [],
      cover: [],
      node_icon: [],
      node_cover: [],
    },
    groupUploadLimitBytes: {},
    firstPostsToModerate: 0,
    moderateLinksFromNewMembers: false,
    warningBanThreshold: 0,
    warningBanDays: 7,
    threadTitleTemplate: "{title}",
    nodeTitleTemplate: "{title}",
    profileTitleTemplate: "{username}",
    indexNowKey: null,
  });
const sent = (operation: string) =>
  backend?.asked.filter((entry) => entry.operation === operation);

test("the cookies form sends exactly its two switches, and expires the site cache", async () => {
  backend = fakeBackend({ "settings.update": echo });
  const digest = await redirectedTo(() =>
    saveCookies(
      null,
      settingsForm([["matomoCookieless", "on"]], "cookieBannerOutsideEu"),
    ),
  );
  expect(digest).toMatch(/;\/admin\/settings\/cookies\?notice=saved;/);
  expect(sent("settings.update")).toHaveLength(1);
  expect(sent("settings.update")?.[0]?.body).toEqual({
    matomoCookieless: true,
    cookieBannerOutsideEu: false,
  });
  // The banner and the tag read both through the cached site.
  expect(expired).toEqual(["site"]);
});

test("a request that does not look like the form's own writes nothing", async () => {
  backend = fakeBackend({ "settings.update": echo });
  const state = await saveCookies(null, new FormData());
  expect(typeof state?.error).toBe("string");
  expect(sent("settings.update")).toEqual([]);
  expect(expired).toEqual([]);
});

test("the policy version is never sent by the form, whatever the request names", async () => {
  backend = fakeBackend({ "settings.update": echo });
  const data = settingsForm(
    [["matomoCookieless", "on"]],
    "cookieBannerOutsideEu",
  );
  data.append("cookiePolicyVersion", "9");
  data.append("shown", "cookiePolicyVersion");
  await redirectedTo(() => saveCookies(null, data));
  expect(sent("settings.update")?.[0]?.body).not.toHaveProperty(
    "cookiePolicyVersion",
  );
});

test("asking everyone again calls the one operation that raises the version, expires the site and returns with a notice", async () => {
  backend = fakeBackend({
    "consent.askAgain": () => Response.json({ policyVersion: 2 }),
  });
  const digest = await redirectedTo(() => askEveryoneAgain());
  expect(digest).toMatch(/;\/admin\/settings\/cookies\?notice=asked;/);
  expect(backend.asked.map((entry) => entry.operation)).toEqual([
    "consent.askAgain",
  ]);
  expect(expired).toEqual(["site"]);
  expect(messages.adminSetup.notices.asked.length).toBeGreaterThan(0);
});

test("a refusal comes back on the form and the site cache is kept", async () => {
  backend = fakeBackend({
    "consent.askAgain": () => refusal(403, "forbidden", "Not allowed."),
  });
  const state = await askEveryoneAgain();
  expect(state?.error).toBeDefined();
  expect(expired).toEqual([]);
});
