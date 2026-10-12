import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { fakeBackend, refusal } from "../groups/test-backend";
import { settingsForm } from "./test-form";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
const cacheModule = await import("next/cache");
const expired: string[] = [];
mock.module("next-intl/server", () => ({
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

const {
  saveGeneral,
  saveMembers,
  saveWarnings,
  saveSeo,
  saveUploads,
  saveLevels,
} = await import("./actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => {
  backend?.restore();
  expired.length = 0;
});
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => cacheModule);
});

const SETTINGS = {
  maxUploadBytes: 1000,
  allowedUploadTypes: {
    attachment: ["image/png"],
    avatar: ["image/png"],
    cover: ["image/png"],
    node_icon: ["image/png"],
    node_cover: ["image/png"],
  },
  groupUploadLimitBytes: { "1": 0, "2": 100, "3": 200, "4": 300 },
  firstPostsToModerate: 0,
  moderateLinksFromNewMembers: false,
  newMemberDays: 7,
  warningBanThreshold: 0,
  warningBanDays: 7,
  threadTitleTemplate: "{title} | {site}",
  nodeTitleTemplate: "{title} | {site}",
  profileTitleTemplate: "{username} | {site}",
  indexNowKey: null,
  siteName: "Sermo",
  defaultLanguage: "en",
  newMemberMentionLimit: 3,
  profilePostsEnabled: true,
  notificationRetentionDays: 90,
  notificationDefaults: {},
  emailHourlyCap: 20,
  conversationEmailIncludesBody: false,
  digestInactiveDays: 3,
  levelStep: 100,
  levelTitles: [{ level: 1, title: "New member" }],
  signatureMaxLength: 300,
  signatureMaxLines: 4,
  customTitleMaxLength: 40,
  standingPostPoints: 1,
  standingReactionsPerPoint: 10,
  standingReferralPoints: 20,
  socialLinks: { discord: "https://d.example", telegram: null, x: null },
  logoFileId: null,
  iconFileId: null,
  backdropFileId: null,
};
const read = () => Response.json(SETTINGS);

const form = settingsForm;

async function redirectedTo(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return String((error as { digest?: unknown }).digest);
  }
  return undefined;
}

const sent = () =>
  backend?.asked.filter((entry) => entry.operation === "settings.update");

const LEVEL_FIELDS: [string, string][] = [
  ["levelStep", "250"],
  ["signatureMaxLength", "200"],
  ["signatureMaxLines", "3"],
  ["customTitleMaxLength", "30"],
  ["standingPostPoints", "2"],
  ["standingReactionsPerPoint", "5"],
  ["standingReferralPoints", "10"],
];

test("the general form sends its three keys and the whole social links, and expires the site cache", async () => {
  backend = fakeBackend({ "settings.get": read, "settings.update": read });
  const digest = await redirectedTo(() =>
    saveGeneral(
      null,
      form(
        [
          ["siteName", "Forum"],
          ["defaultLanguage", "es"],
          ["socialLinks.discord", "https://d.example"],
          ["socialLinks.telegram", "https://t.example"],
          ["socialLinks.x", "  "],
        ],
        "profilePostsEnabled",
      ),
    ),
  );
  expect(digest).toMatch(/;\/admin\/settings\?notice=saved;/);
  expect(sent()).toHaveLength(1);
  expect(sent()?.[0]?.body).toEqual({
    siteName: "Forum",
    defaultLanguage: "es",
    profilePostsEnabled: false,
    socialLinks: {
      discord: "https://d.example",
      telegram: "https://t.example",
      x: null,
    },
  });
  expect(expired).toEqual(["site"]);
});

test("a language the contract does not list is refused without a call", async () => {
  backend = fakeBackend({ "settings.get": read });
  const state = await saveGeneral(
    null,
    form([
      ["siteName", "Forum"],
      ["defaultLanguage", "xx"],
    ]),
  );
  expect(sent()).toEqual([]);
  expect(state).toEqual({
    fields: { defaultLanguage: messages.adminSetup.errors.language },
  });
});

test("the new-member form sends exactly its four keys", async () => {
  backend = fakeBackend({ "settings.update": read });
  await redirectedTo(() =>
    saveMembers(
      null,
      form([
        ["newMemberDays", "14"],
        ["firstPostsToModerate", "2"],
        ["moderateLinksFromNewMembers", "on"],
        ["newMemberMentionLimit", "1"],
      ]),
    ),
  );
  expect(sent()?.[0]?.body).toEqual({
    newMemberDays: 14,
    firstPostsToModerate: 2,
    moderateLinksFromNewMembers: true,
    newMemberMentionLimit: 1,
  });
  expect(expired).toEqual([]);
});

test("the warnings form sends exactly its two keys", async () => {
  backend = fakeBackend({ "settings.update": read });
  await redirectedTo(() =>
    saveWarnings(
      null,
      form([
        ["warningBanThreshold", "10"],
        ["warningBanDays", "3"],
      ]),
    ),
  );
  expect(sent()?.[0]?.body).toEqual({
    warningBanThreshold: 10,
    warningBanDays: 3,
  });
});

test("the SEO form sends its templates and null for an empty key", async () => {
  backend = fakeBackend({ "settings.update": read });
  await redirectedTo(() =>
    saveSeo(
      null,
      form([
        ["threadTitleTemplate", "{title}"],
        ["nodeTitleTemplate", "{title} - {site}"],
        ["profileTitleTemplate", "{username}"],
        ["indexNowKey", ""],
      ]),
    ),
  );
  expect(sent()?.[0]?.body).toEqual({
    threadTitleTemplate: "{title}",
    nodeTitleTemplate: "{title} - {site}",
    profileTitleTemplate: "{username}",
    indexNowKey: null,
  });
});

test("one group's limit is sent with every other group's stored limit", async () => {
  backend = fakeBackend({ "settings.get": read, "settings.update": read });
  await redirectedTo(() =>
    saveUploads(
      null,
      form([
        ["maxUploadBytes", "2000"],
        ["allowedUploadTypes.avatar", "image/png\nimage/webp"],
        ["groupUploadLimitBytes.3", "5000"],
      ]),
    ),
  );
  expect(sent()?.[0]?.body).toEqual({
    maxUploadBytes: 2000,
    allowedUploadTypes: {
      ...SETTINGS.allowedUploadTypes,
      avatar: ["image/png", "image/webp"],
    },
    groupUploadLimitBytes: { "1": 0, "2": 100, "3": 5000, "4": 300 },
  });
});

test("an empty group field leaves the group out, which is unlimited", async () => {
  backend = fakeBackend({ "settings.get": read, "settings.update": read });
  await redirectedTo(() =>
    saveUploads(
      null,
      form([
        ["maxUploadBytes", "2000"],
        ["groupUploadLimitBytes.2", ""],
        ["groupUploadLimitBytes.9", ""],
      ]),
    ),
  );
  const body = sent()?.[0]?.body as { groupUploadLimitBytes: unknown };
  expect(body.groupUploadLimitBytes).toEqual({ "1": 0, "3": 200, "4": 300 });
});

test("a group that is not a record id is refused without a call", async () => {
  backend = fakeBackend({ "settings.get": read });
  const state = await saveUploads(
    null,
    form([
      ["maxUploadBytes", "2000"],
      ["groupUploadLimitBytes.0x1", "5"],
    ]),
  );
  expect(state).toEqual({ error: messages.adminSetup.errors.id });
  expect(sent()).toEqual([]);
});

test("the levels form sends its keys and the whole list of titles, dropping empty rows", async () => {
  backend = fakeBackend({ "settings.update": read });
  await redirectedTo(() =>
    saveLevels(
      null,
      form([
        ...LEVEL_FIELDS,
        ["levelTitles.0.level", "1"],
        ["levelTitles.0.title", "Newcomer"],
        ["levelTitles.1.level", ""],
        ["levelTitles.1.title", ""],
        ["levelTitles.2.level", "5"],
        ["levelTitles.2.title", "Veteran"],
      ]),
    ),
  );
  expect(sent()?.[0]?.body).toEqual({
    levelStep: 250,
    signatureMaxLength: 200,
    signatureMaxLines: 3,
    customTitleMaxLength: 30,
    standingPostPoints: 2,
    standingReactionsPerPoint: 5,
    standingReferralPoints: 10,
    levelTitles: [
      { level: 1, title: "Newcomer" },
      { level: 5, title: "Veteran" },
    ],
  });
});

test("a refusal naming an entry of the list is shown on the row it came from", async () => {
  backend = fakeBackend({
    "settings.update": () =>
      Response.json(
        {
          error: {
            code: "validation",
            message: "Invalid input",
            issues: [
              { path: ["levelTitles", 1, "title"], message: "Too long." },
            ],
          },
        },
        { status: 422 },
      ),
  });
  const state = await saveLevels(
    null,
    form([
      ...LEVEL_FIELDS,
      ["levelTitles.0.level", "1"],
      ["levelTitles.0.title", "A"],
      ["levelTitles.1.level", ""],
      ["levelTitles.1.title", ""],
      ["levelTitles.2.level", "5"],
      ["levelTitles.2.title", "B"],
    ]),
  );
  expect(state).toEqual({
    error: undefined,
    fields: { "levelTitles.2": "Too long." },
  });
});

test("a refusal names the field and nothing is expired", async () => {
  backend = fakeBackend({
    "settings.update": () =>
      Response.json(
        {
          error: {
            code: "validation",
            message: "Invalid input",
            issues: [{ path: ["warningBanDays"], message: "Too big." }],
          },
        },
        { status: 422 },
      ),
  });
  const state = await saveWarnings(
    null,
    form([
      ["warningBanThreshold", "10"],
      ["warningBanDays", "99999"],
    ]),
  );
  expect(state).toEqual({
    error: undefined,
    fields: { warningBanDays: "Too big." },
  });
  expect(expired).toEqual([]);
});

test("a refusal without a field is shown at the top", async () => {
  backend = fakeBackend({
    "settings.update": () => refusal(403, "forbidden", "Not allowed."),
  });
  expect(
    await saveMembers(
      null,
      form([
        ["newMemberDays", "7"],
        ["firstPostsToModerate", "0"],
        ["newMemberMentionLimit", "3"],
      ]),
    ),
  ).toEqual({ error: "Not allowed." });
});

test("text in a number field is refused without a call", async () => {
  backend = fakeBackend({});
  expect(
    await saveWarnings(
      null,
      form([
        ["warningBanThreshold", "ten"],
        ["warningBanDays", "3"],
      ]),
    ),
  ).toEqual({
    fields: { warningBanThreshold: messages.adminSetup.errors.number },
  });
  expect(backend.asked).toEqual([]);
});

test("a request without the markers of what the form showed is refused and nothing is sent", async () => {
  backend = fakeBackend({ "settings.get": read, "settings.update": read });
  const bare = new FormData();
  bare.append("newMemberDays", "14");
  bare.append("firstPostsToModerate", "2");
  expect(await saveMembers(null, bare)).toEqual({
    error: messages.lib.errors.generic,
  });
  expect(await saveGeneral(null, new FormData())).toEqual({
    error: messages.lib.errors.generic,
  });
  expect(backend.asked).toEqual([]);
});

test("a setting the form did not show is not sent, whatever else it posts", async () => {
  backend = fakeBackend({ "settings.get": read, "settings.update": read });
  // Only the site name is marked: the language is not read, and the switch that is not posted is
  // not taken for "off".
  const data = new FormData();
  data.append("shown", "siteName");
  data.append("siteName", "Forum");
  data.append("defaultLanguage", "es");
  await redirectedTo(() => saveGeneral(null, data));
  const body = sent()?.[0]?.body as Record<string, unknown>;
  expect(body.siteName).toBe("Forum");
  expect(body).not.toHaveProperty("defaultLanguage");
  expect(body).not.toHaveProperty("profilePostsEnabled");
});

test("a setting the form showed but did not post a value for is refused, but for a switch", async () => {
  backend = fakeBackend({ "settings.update": read });
  const data = new FormData();
  data.append("shown", "warningBanThreshold");
  data.append("shown", "warningBanDays");
  data.append("warningBanThreshold", "10");
  expect(await saveWarnings(null, data)).toEqual({
    error: messages.lib.errors.generic,
  });
  expect(backend.asked).toEqual([]);
});

test("the titles are replaced only by a form that showed them; shown and empty clears them", async () => {
  backend = fakeBackend({ "settings.update": read });
  await redirectedTo(() => saveLevels(null, form(LEVEL_FIELDS)));
  expect(sent()?.[0]?.body).not.toHaveProperty("levelTitles");
  backend.restore();
  backend = fakeBackend({ "settings.update": read });
  // The rows posted without the marker of the list are not taken for it either.
  const stray = form(LEVEL_FIELDS);
  stray.delete("shown");
  for (const [name] of LEVEL_FIELDS) stray.append("shown", name);
  stray.append("levelTitles.0.level", "1");
  stray.append("levelTitles.0.title", "X");
  await redirectedTo(() => saveLevels(null, stray));
  expect(sent()?.[0]?.body).not.toHaveProperty("levelTitles");
  backend.restore();
  backend = fakeBackend({ "settings.update": read });
  await redirectedTo(() => saveLevels(null, form(LEVEL_FIELDS, "levelTitles")));
  expect(sent()?.[0]?.body).toMatchObject({ levelTitles: [] });
});
