import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { form, invalid, redirectedTo } from "../content-kit/harness";
import { fakeBackend } from "../groups/test-backend";

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

const { saveNotificationDefaults } = await import("./actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => cacheModule);
});

const OTHER = { inApp: true, email: false, push: false };
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
  defaultLanguage: "en",
  newMemberMentionLimit: 3,
  profilePostsEnabled: true,
  notificationRetentionDays: 90,
  notificationDefaults: { quote: OTHER },
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

const TYPES = {
  items: [
    {
      id: "reply",
      label: "reply",
      description: "reply",
      defaults: { inApp: true, email: true, push: false },
      required: false,
      channels: ["inApp", "email", "push"],
    },
    {
      id: "quote",
      label: "quote",
      description: "quote",
      defaults: OTHER,
      required: false,
      channels: ["inApp", "email"],
    },
    {
      id: "security",
      label: "security",
      description: "security",
      defaults: { inApp: true, email: true, push: false },
      required: true,
      channels: ["inApp", "email"],
    },
  ],
};
const types = () => Response.json(TYPES);

const sent = () =>
  backend?.asked.filter((entry) => entry.operation === "settings.update");

test("turning one email default off sends the whole map and the retention, and only those keys", async () => {
  backend = fakeBackend({
    "settings.get": settings,
    "notifications.types": types,
    "settings.update": settings,
  });
  const digest = await redirectedTo(() =>
    saveNotificationDefaults(
      null,
      form([
        ["notificationRetentionDays", "60"],
        ["reply:inApp", "on"],
        ["quote:inApp", "on"],
      ]),
    ),
  );
  expect(digest).toMatch(/;\/admin\/notifications\?notice=saved;/);
  expect(sent()).toHaveLength(1);
  expect(sent()?.[0]?.body).toEqual({
    notificationRetentionDays: 60,
    notificationDefaults: {
      quote: OTHER,
      reply: { inApp: true, email: false, push: false },
    },
  });
});

test("a type left as it was keeps its stored entry and a required type is never written", async () => {
  backend = fakeBackend({
    "settings.get": settings,
    "notifications.types": types,
    "settings.update": settings,
  });
  await redirectedTo(() =>
    saveNotificationDefaults(
      null,
      form([
        ["notificationRetentionDays", "90"],
        ["reply:inApp", "on"],
        ["reply:email", "on"],
        ["quote:inApp", "on"],
      ]),
    ),
  );
  expect(sent()?.[0]?.body).toEqual({
    notificationRetentionDays: 90,
    notificationDefaults: { quote: OTHER },
  });
});

test("a retention that is not a number is refused without a call", async () => {
  backend = fakeBackend({});
  const state = await saveNotificationDefaults(
    null,
    form([["notificationRetentionDays", "many"]]),
  );
  expect(backend.asked).toEqual([]);
  expect(state).toEqual({
    fields: {
      notificationRetentionDays: messages.adminCommunication.errors.number,
    },
  });
});

test("the backend's refusal of the retention is shown next to it", async () => {
  backend = fakeBackend({
    "settings.get": settings,
    "notifications.types": types,
    "settings.update": () => invalid("notificationRetentionDays", "Too big."),
  });
  const state = await saveNotificationDefaults(
    null,
    form([["notificationRetentionDays", "99999"]]),
  );
  expect(state).toEqual({ fields: { notificationRetentionDays: "Too big." } });
});
