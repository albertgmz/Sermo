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

const {
  saveGeneral,
  saveAntispam,
  saveMembers,
  saveSeo,
  saveUploads,
  saveLevels,
  saveHomeTab,
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
  signatureMaxLinks: 3,
  signatureMaxImages: 1,
  signatureMaxSmilies: 5,
  signatureMaxTextSize: 4,
  signatureFormats: ["bold", "link"],
  signatureRule: { match: "all", conditions: [] },
  customTitleMaxLength: 40,
  standingPostPoints: 1,
  standingReactionsPerPoint: 10,
  standingReferralPoints: 20,
  socialLinks: { discord: "https://d.example", telegram: null, x: null },
  logoFileId: null,
  iconFileId: null,
  backdropFileId: null,
  turnstileEnabled: false,
  turnstileSiteKey: "",
  turnstileForms: ["register", "login"],
  turnstileSecretSet: false,
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
  ["customTitleMaxLength", "30"],
  ["standingPostPoints", "2"],
  ["standingReactionsPerPoint", "5"],
  ["standingReferralPoints", "10"],
];

test("the general form sends its four keys and the whole social links, and expires the site cache", async () => {
  backend = fakeBackend({ "settings.get": read, "settings.update": read });
  const digest = await redirectedTo(() =>
    saveGeneral(
      null,
      form(
        [
          ["siteName", "Forum"],
          ["defaultLanguage", "es"],
          ["forumStatsEnabled", "on"],
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
    forumStatsEnabled: true,
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

const POST_COUNT_RULE = {
  match: "all",
  conditions: [{ criterion: "post_count", value: 5 }],
};

test("the anti-spam form sends the flood interval and both rules whole", async () => {
  backend = fakeBackend({ "settings.update": read });
  const digest = await redirectedTo(() =>
    saveAntispam(
      null,
      form([
        ["floodSeconds", "20"],
        ["linksRule", JSON.stringify(POST_COUNT_RULE)],
        ["approvalRule", JSON.stringify({ match: "any", conditions: [] })],
      ]),
    ),
  );
  expect(sent()?.[0]?.body).toEqual({
    floodSeconds: 20,
    linksRule: POST_COUNT_RULE,
    approvalRule: { match: "any", conditions: [] },
  });
  expect(digest).toContain("/admin/settings/antispam?notice=saved");
});

const SIGNATURE_FIELDS: [string, string][] = [
  ["signatureMaxLength", "200"],
  ["signatureMaxLines", "3"],
  ["signatureMaxLinks", "2"],
  ["signatureMaxImages", "0"],
  ["signatureMaxSmilies", "-1"],
  ["signatureMaxTextSize", "5"],
];

test("the anti-spam form sends the signature limits, the ticked kinds and the signature rule", async () => {
  backend = fakeBackend({ "settings.update": read });
  const digest = await redirectedTo(() =>
    saveAntispam(
      null,
      form([
        ["floodSeconds", "0"],
        ...SIGNATURE_FIELDS,
        // Ticked in the form's order or not, the list goes in the contract's order.
        ["signatureFormats", "link"],
        ["signatureFormats", "bold"],
        ["signatureRule", JSON.stringify(POST_COUNT_RULE)],
      ]),
    ),
  );
  expect(sent()?.[0]?.body).toEqual({
    floodSeconds: 0,
    signatureMaxLength: 200,
    signatureMaxLines: 3,
    signatureMaxLinks: 2,
    signatureMaxImages: 0,
    signatureMaxSmilies: -1,
    signatureMaxTextSize: 5,
    signatureFormats: ["bold", "link"],
    signatureRule: POST_COUNT_RULE,
  });
  expect(digest).toContain("/admin/settings/antispam?notice=saved");
});

test("a list with nothing ticked is sent empty, and one the form did not show is not sent", async () => {
  backend = fakeBackend({ "settings.update": read });
  await redirectedTo(() =>
    saveAntispam(
      null,
      form([["floodSeconds", "0"]], "signatureFormats", "turnstileForms"),
    ),
  );
  expect(sent()?.[0]?.body).toEqual({
    floodSeconds: 0,
    signatureFormats: [],
    turnstileForms: [],
  });
  const data = form([["floodSeconds", "0"]]);
  data.append("signatureFormats", "bold");
  await redirectedTo(() => saveAntispam(null, data));
  expect(sent()?.[1]?.body).toEqual({ floodSeconds: 0 });
});

test("a kind the contract does not know is never sent", async () => {
  backend = fakeBackend({ "settings.update": read });
  await redirectedTo(() =>
    saveAntispam(
      null,
      form([
        ["floodSeconds", "0"],
        ["signatureFormats", "bold"],
        ["signatureFormats", "script"],
        ["turnstileForms", "register"],
        ["turnstileForms", "everything"],
      ]),
    ),
  );
  expect(sent()?.[0]?.body).toEqual({
    floodSeconds: 0,
    signatureFormats: ["bold"],
    turnstileForms: ["register"],
  });
});

test("the Turnstile settings are sent, and the public site is told to renew its identity", async () => {
  backend = fakeBackend({ "settings.update": read });
  await redirectedTo(() =>
    saveAntispam(
      null,
      form([
        ["floodSeconds", "0"],
        ["turnstileEnabled", "on"],
        ["turnstileSiteKey", "0x4AAA-site"],
        ["turnstileForms", "register"],
        ["turnstileForms", "passwordReset"],
      ]),
    ),
  );
  expect(sent()?.[0]?.body).toEqual({
    floodSeconds: 0,
    turnstileEnabled: true,
    turnstileSiteKey: "0x4AAA-site",
    turnstileForms: ["register", "passwordReset"],
  });
  expect(expired).toContain("site");
});

test("the Turnstile secret: typing replaces it, the box removes it, neither leaves it alone", async () => {
  backend = fakeBackend({ "settings.update": read });
  const save = (fields: [string, string][], ...unticked: string[]) =>
    redirectedTo(() =>
      saveAntispam(null, form([["floodSeconds", "0"], ...fields], ...unticked)),
    );
  await save([["turnstileSecret", "  0x4AAA-secret  "]]);
  expect(sent()?.[0]?.body).toEqual({
    floodSeconds: 0,
    turnstileSecret: "0x4AAA-secret",
  });
  // Typing wins over the box.
  await save([
    ["turnstileSecret", "new"],
    ["turnstileSecretRemove", "on"],
  ]);
  expect(sent()?.[1]?.body).toMatchObject({ turnstileSecret: "new" });
  await save([
    ["turnstileSecret", ""],
    ["turnstileSecretRemove", "on"],
  ]);
  expect(sent()?.[2]?.body).toMatchObject({ turnstileSecret: null });
  await save([["turnstileSecret", "   "]]);
  expect(sent()?.[3]?.body).toEqual({ floodSeconds: 0 });
  // A request that never showed the row cannot touch the secret.
  const data = form([["floodSeconds", "0"]]);
  data.append("turnstileSecret", "sneaked");
  await redirectedTo(() => saveAntispam(null, data));
  expect(sent()?.[4]?.body).toEqual({ floodSeconds: 0 });
});

test("the backend's refusal to turn Turnstile on is shown under its switch", async () => {
  backend = fakeBackend({
    "settings.update": () =>
      Response.json(
        {
          error: {
            code: "validation",
            message: "Turnstile needs a site key and a secret.",
            issues: [
              {
                path: ["turnstileEnabled"],
                message: "Turnstile needs a site key and a secret.",
              },
            ],
          },
        },
        { status: 422 },
      ),
  });
  expect(
    await saveAntispam(
      null,
      form([
        ["floodSeconds", "0"],
        ["turnstileEnabled", "on"],
        ["turnstileSiteKey", ""],
      ]),
    ),
  ).toEqual({
    error: undefined,
    fields: { turnstileEnabled: "Turnstile needs a site key and a secret." },
  });
});

test("a rule the anti-spam form did not show is not sent", async () => {
  backend = fakeBackend({ "settings.update": read });
  const data = form([
    ["floodSeconds", "0"],
    ["approvalRule", JSON.stringify(POST_COUNT_RULE)],
  ]);
  // A links rule posted without its marker is not read.
  data.append("linksRule", JSON.stringify(POST_COUNT_RULE));
  await redirectedTo(() => saveAntispam(null, data));
  expect(sent()?.[0]?.body).toEqual({
    floodSeconds: 0,
    approvalRule: POST_COUNT_RULE,
  });
});

test("a rule that is not a rule is refused under its own row and nothing is sent", async () => {
  backend = fakeBackend({});
  expect(
    await saveAntispam(
      null,
      form([
        ["floodSeconds", "0"],
        ["linksRule", "not json"],
        ["approvalRule", JSON.stringify({ match: "all", conditions: [] })],
      ]),
    ),
  ).toEqual({ fields: { linksRule: messages.adminGroups.errors.rule } });
  expect(backend.asked).toEqual([]);
});

test("the backend's refusal of a rule is shown under that rule", async () => {
  backend = fakeBackend({
    "settings.update": () =>
      Response.json(
        {
          error: {
            code: "validation",
            message: "The criterion warning_points_below is too heavy.",
            issues: [
              {
                path: ["linksRule"],
                message: "The criterion warning_points_below is too heavy.",
              },
            ],
          },
        },
        { status: 422 },
      ),
  });
  expect(
    await saveAntispam(
      null,
      form([
        ["floodSeconds", "5"],
        ["linksRule", JSON.stringify(POST_COUNT_RULE)],
      ]),
    ),
  ).toEqual({
    error: undefined,
    fields: { linksRule: "The criterion warning_points_below is too heavy." },
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

test("saving the upload limits expires the cached site, which the upload routes read the limit from", async () => {
  expired.length = 0;
  backend = fakeBackend({ "settings.get": read, "settings.update": read });
  await redirectedTo(() =>
    saveUploads(null, form([["maxUploadBytes", "2000"]])),
  );
  expect(expired).toEqual(["site"]);
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
  data.append("shown", "newMemberDays");
  data.append("shown", "firstPostsToModerate");
  data.append("newMemberDays", "10");
  expect(await saveMembers(null, data)).toEqual({
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

test("the general form sends the analytics setting whole only when it showed it", async () => {
  backend = fakeBackend({ "settings.get": read, "settings.update": read });
  await redirectedTo(() =>
    saveGeneral(
      null,
      form(
        [
          ["siteName", "Forum"],
          ["analytics.provider", "matomo"],
          ["analytics.url", " https://stats.example.com/ "],
          ["analytics.siteId", "3"],
          ["analytics.measurementId", "G-IGNORED1"],
        ],
        "analytics",
      ),
    ),
  );
  expect(sent()?.[0]?.body).toMatchObject({
    analytics: {
      provider: "matomo",
      url: "https://stats.example.com/",
      siteId: 3,
    },
  });
  expect(sent()?.[0]?.body).not.toHaveProperty("analytics.measurementId");
  await redirectedTo(() =>
    saveGeneral(
      null,
      form(
        [
          ["siteName", "Forum"],
          ["analytics.provider", "google"],
          ["analytics.measurementId", "G-ABC123"],
        ],
        "analytics",
      ),
    ),
  );
  expect(sent()?.[1]?.body).toMatchObject({
    analytics: { provider: "google", measurementId: "G-ABC123" },
  });
  await redirectedTo(() =>
    saveGeneral(
      null,
      form([
        ["siteName", "Forum"],
        ["analytics.provider", "none"],
      ]),
    ),
  );
  expect(sent()?.[2]?.body).not.toHaveProperty("analytics");
});

test("a Matomo site id that is not a number stays on the form", async () => {
  backend = fakeBackend({ "settings.get": read });
  const state = await saveGeneral(
    null,
    form(
      [
        ["siteName", "Forum"],
        ["analytics.provider", "matomo"],
        ["analytics.url", "https://stats.example.com/"],
        ["analytics.siteId", "abc"],
      ],
      "analytics",
    ),
  );
  expect(state).toEqual({
    fields: { "analytics.siteId": messages.adminSetup.errors.number },
  });
  expect(sent()).toEqual([]);
});

const MEMBERS = () =>
  Response.json({
    items: [
      { id: 7, username: "Ada" },
      { id: 8, username: "Adam" },
      { id: 9, username: "Mary Jane" },
    ],
  });

test("the levels form turns typed usernames into ids and sends the switch", async () => {
  backend = fakeBackend({ "settings.update": read, "users.search": MEMBERS });
  await redirectedTo(() =>
    saveLevels(
      null,
      form(
        [
          ...LEVEL_FIELDS,
          ["standingExcludedUserIds", "ada, ADAM\n mary jane \nada"],
        ],
        "standingExcludeStaff",
      ),
    ),
  );
  expect(sent()?.[0]?.body).toMatchObject({
    standingExcludeStaff: false,
    standingExcludedUserIds: [7, 8, 9],
  });
  await redirectedTo(() =>
    saveLevels(
      null,
      form([
        ...LEVEL_FIELDS,
        ["standingExcludeStaff", "on"],
        ["standingExcludedUserIds", ""],
      ]),
    ),
  );
  expect(sent()?.[1]?.body).toMatchObject({
    standingExcludeStaff: true,
    standingExcludedUserIds: [],
  });
});

test("a username that belongs to no member is refused and nothing is saved", async () => {
  backend = fakeBackend({ "settings.update": read, "users.search": MEMBERS });
  const state = await saveLevels(
    null,
    form([...LEVEL_FIELDS, ["standingExcludedUserIds", "ada\nzed pop"]]),
  );
  expect(state).toEqual({
    fields: {
      standingExcludedUserIds: messages.adminSetup.errors.unknownMembers,
    },
  });
  expect(sent()).toEqual([]);
});

test("names shown in the textarea, one per line, are read back to the same ids", async () => {
  backend = fakeBackend({ "settings.update": read, "users.search": MEMBERS });
  const shown = ["Ada", "Mary Jane"].join("\n");
  await redirectedTo(() =>
    saveLevels(
      null,
      form([...LEVEL_FIELDS, ["standingExcludedUserIds", shown]]),
    ),
  );
  expect(sent()?.[0]?.body).toMatchObject({ standingExcludedUserIds: [7, 9] });
});

const everyone = JSON.stringify({ match: "all", conditions: [] });
const members = JSON.stringify({
  match: "all",
  conditions: [{ criterion: "is_guest", value: 0 }],
});

test("the home tab form sends its rules ordered by position, leaves out rows with no tab, and expires the site cache", async () => {
  backend = fakeBackend({ "settings.update": read });
  const digest = await redirectedTo(() =>
    saveHomeTab(
      null,
      form(
        [
          ["homeTab.rules.0.rule", members],
          ["homeTab.rules.0.tab", "forums"],
          ["homeTab.rules.0.position", "3"],
          ["homeTab.rules.1.rule", everyone],
          ["homeTab.rules.1.tab", ""],
          ["homeTab.rules.1.position", "2"],
          ["homeTab.rules.2.rule", everyone],
          ["homeTab.rules.2.tab", "media"],
          ["homeTab.rules.2.position", "1"],
          ["homeTab.fallback", "hot"],
        ],
        "homeTab",
      ),
    ),
  );
  expect(digest).toContain("/admin/settings/home?notice=saved");
  expect(sent()).toHaveLength(1);
  expect(sent()?.[0]?.body).toEqual({
    homeTab: {
      rules: [
        { rule: { match: "all", conditions: [] }, tab: "media" },
        {
          rule: {
            match: "all",
            conditions: [{ criterion: "is_guest", value: 0 }],
          },
          tab: "forums",
        },
      ],
      fallback: "hot",
    },
  });
  expect(expired).toEqual(["site"]);
});

test("equal positions keep the order of the rows, and a blank position is the row's place", async () => {
  backend = fakeBackend({ "settings.update": read });
  await redirectedTo(() =>
    saveHomeTab(
      null,
      form(
        [
          ["homeTab.rules.0.rule", everyone],
          ["homeTab.rules.0.tab", "hot"],
          ["homeTab.rules.0.position", "2"],
          ["homeTab.rules.1.rule", members],
          ["homeTab.rules.1.tab", "forums"],
          ["homeTab.rules.1.position", "2"],
          ["homeTab.rules.2.rule", everyone],
          ["homeTab.rules.2.tab", "media"],
          ["homeTab.rules.2.position", ""],
          ["homeTab.fallback", "latest"],
        ],
        "homeTab",
      ),
    ),
  );
  const body = sent()?.[0]?.body as {
    homeTab: { rules: { tab: string }[] };
  };
  const { rules } = body.homeTab;
  expect(rules.map((rule) => rule.tab)).toEqual(["hot", "forums", "media"]);
});

test("a form that did not show the home tab setting writes nothing", async () => {
  backend = fakeBackend({ "settings.update": read });
  const state = await saveHomeTab(null, form([["homeTab.fallback", "hot"]]));
  expect(state?.error).toBeDefined();
  expect(sent()).toHaveLength(0);
});

test("a rule the form cannot read is shown on its row and nothing is sent", async () => {
  backend = fakeBackend({ "settings.update": read });
  const state = await saveHomeTab(
    null,
    form(
      [
        ["homeTab.rules.0.rule", "not json"],
        ["homeTab.rules.0.tab", "hot"],
        ["homeTab.fallback", "latest"],
      ],
      "homeTab",
    ),
  );
  expect(Object.keys(state?.fields ?? {})).toEqual(["homeTab.rules.0.rule"]);
  expect(sent()).toHaveLength(0);
});

test("a refusal naming a rule is shown on the row it came from, whatever the order sent", async () => {
  backend = fakeBackend({
    "settings.update": () =>
      Response.json(
        {
          error: {
            code: "validation",
            message: "Invalid input",
            issues: [
              {
                path: ["homeTab", "rules", 0, "tab"],
                message: "Guests have no Following tab.",
              },
              {
                path: ["homeTab", "fallback"],
                message: "Also for guests.",
              },
            ],
          },
        },
        { status: 422 },
      ),
  });
  const state = await saveHomeTab(
    null,
    form(
      [
        ["homeTab.rules.0.rule", everyone],
        ["homeTab.rules.0.tab", "hot"],
        ["homeTab.rules.0.position", "2"],
        ["homeTab.rules.1.rule", everyone],
        ["homeTab.rules.1.tab", "following"],
        ["homeTab.rules.1.position", "1"],
        ["homeTab.fallback", "following"],
      ],
      "homeTab",
    ),
  );
  expect(state?.fields).toEqual({
    "homeTab.rules.1.tab": "Guests have no Following tab.",
    "homeTab.fallback": "Also for guests.",
  });
  expect(expired).toEqual([]);
});
