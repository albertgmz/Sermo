import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { translator } from "@/lib/test-intl";
import { invalid, redirectedTo } from "../content-kit/harness";
import { fakeBackend } from "../groups/test-backend";
import { settingsForm } from "../settings/test-form";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
const cacheModule = await import("next/cache");
mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/cache", () => ({ ...cacheModule, updateTag: () => {} }));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { saveEmail } = await import("./actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
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
  groupUploadLimitBytes: {},
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
  siteDescription: "",
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
  socialLinks: { discord: null, telegram: null, x: null },
  logoFileId: null,
  iconFileId: null,
  backdropFileId: null,
};
const settings = () => Response.json(SETTINGS);
const form = settingsForm;

test("the form sends exactly its three keys", async () => {
  backend = fakeBackend({ "settings.update": settings });
  const digest = await redirectedTo(() =>
    saveEmail(
      null,
      form([
        ["emailHourlyCap", "5"],
        ["conversationEmailIncludesBody", "on"],
        ["digestInactiveDays", "10"],
      ]),
    ),
  );
  expect(digest).toMatch(/;\/admin\/email\?notice=saved;/);
  expect(backend.asked).toHaveLength(1);
  expect(backend.asked[0]?.body).toEqual({
    emailHourlyCap: 5,
    conversationEmailIncludesBody: true,
    digestInactiveDays: 10,
  });
});

test("an unticked switch is sent as false", async () => {
  backend = fakeBackend({ "settings.update": settings });
  await redirectedTo(() =>
    saveEmail(
      null,
      form(
        [
          ["emailHourlyCap", "5"],
          ["digestInactiveDays", "10"],
        ],
        "conversationEmailIncludesBody",
      ),
    ),
  );
  expect(backend.asked[0]?.body).toMatchObject({
    conversationEmailIncludesBody: false,
  });
});

test("a number that is not whole is refused without a call", async () => {
  backend = fakeBackend({});
  const state = await saveEmail(
    null,
    form([
      ["emailHourlyCap", "1.5"],
      ["digestInactiveDays", "10"],
    ]),
  );
  expect(backend.asked).toEqual([]);
  expect(state?.fields).toHaveProperty("emailHourlyCap");
});

test("the backend's refusal is shown next to its field", async () => {
  backend = fakeBackend({
    "settings.update": () => invalid("digestInactiveDays", "Too big."),
  });
  const state = await saveEmail(
    null,
    form([
      ["emailHourlyCap", "5"],
      ["digestInactiveDays", "9999"],
    ]),
  );
  expect(state).toEqual({ fields: { digestInactiveDays: "Too big." } });
});
