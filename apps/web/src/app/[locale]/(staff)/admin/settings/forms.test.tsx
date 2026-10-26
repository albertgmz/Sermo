import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { settingsGet } from "@sermo/core/contracts";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { siteBody } from "@/lib/test-bodies";
import { CRITERIA_BODY } from "@/lib/test-criteria";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";
import { fakeBackend, refusal } from "../groups/test-backend";
import { rowText, SETTING_ROWS } from "./search-rows";
import { SETTINGS } from "./test-settings";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
// The settings of a form come from here; another suite replaces the module for good, so the
// answer is set here rather than read through the fake backend.
mock.module("./data", () => ({
  getSettings: async () => settingsGet.output.parse(SETTINGS),
}));
// The identity form draws the site's pictures, read through the site's cached function.
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
const intl = await import("next-intl/server");
// The rows read their words through the library's hook and the provider of `withIntl`, whatever
// stand-in another suite left in place for it.
const nextIntl = await import("next-intl");
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
const { GeneralForm } = await import("./general-form");
const { MembersForm } = await import("./members/members-form");
const { AntispamForm } = await import("./antispam/antispam-form");
const { UploadsForm } = await import("./uploads/uploads-form");
const { SeoForm } = await import("./seo/seo-form");
const { LevelsForm } = await import("./levels/levels-form");
const { CookiesForm } = await import("./cookies/cookies-form");
const { HomeForm } = await import("./home/home-form");
const { IdentityForm } = await import("./identity/identity-form");
const { TypeForm, WarningTypes } = await import("./warnings/warning-types");
const { ActionForm, WarningActions } = await import(
  "./warnings/warning-actions"
);

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next-intl", () => nextIntl);
  mock.module("next/cache", () => nextCache);
});

// Every screen of the settings is one form: the controls it posts and the settings it names as
// shown (the action writes only those).
const answers = {
  "auth.me": () => Response.json(viewerBody(true)),
  // Without the permission to list groups, the form names the ones the settings hold.
  "groups.list": () => refusal(403, "forbidden"),
  "warningTypes.list": () =>
    Response.json({
      items: [
        {
          id: 1,
          name: "Spam",
          nameEn: "Spam",
          nameEs: "Correo basura",
          points: 2,
          expiryDays: 30,
          defaultReason: "",
          locked: false,
        },
      ],
    }),
  "warningActions.list": () =>
    Response.json({
      items: [
        {
          id: 1,
          threshold: 5,
          kind: "ban",
          days: null,
          groupId: null,
          groupTitle: null,
          restrictionKind: null,
        },
      ],
    }),
  "nodes.list": () => Response.json({ items: [] }),
  "criteria.list": () =>
    Response.json({
      items: CRITERIA_BODY,
      groups: [],
      awards: [],
      creditRules: [],
      reactionTypes: [],
    }),
  "shopCategories.list": () => Response.json({ items: [] }),
  "users.cards": () => Response.json({ items: [] }),
  "site.get": () => Response.json(siteBody()),
};

async function controls(form: () => Promise<React.ReactNode>) {
  backend = fakeBackend(answers);
  // The rows are async components: the stream settles them.
  const html = await new Response(
    await renderToReadableStream(withIntl(await form())),
  ).text();
  return {
    html,
    names: new Set(
      [...html.matchAll(/<(?:input|select|textarea)[^>]*? name="([^"]+)"/g)]
        .map(([, name]) => name)
        .filter((name) => name !== "shown"),
    ),
    shown: [...html.matchAll(/name="shown" value="([^"]+)"/g)].map(
      ([, key]) => key,
    ),
  };
}

test("the general form keeps every setting, the social links and the analytics tag", async () => {
  const { names, shown, html } = await controls(GeneralForm);
  for (const name of [
    "siteName",
    "siteDescription",
    "defaultLanguage",
    "profilePostsEnabled",
    "socialLinks.discord",
    "socialLinks.telegram",
    "socialLinks.x",
    "analytics.provider",
    "analytics.measurementId",
    "analytics.tagPath",
  ])
    expect(names.has(name), name).toBe(true);
  for (const key of [
    "siteName",
    "siteDescription",
    "defaultLanguage",
    "profilePostsEnabled",
    "analytics",
  ])
    expect(shown, key).toContain(key);
  // The forum statistics are a widget now, placed with the other widgets.
  expect(names.has("forumStatsEnabled")).toBe(false);
  // The help sits with its field, and the save bar closes the form.
  expect(html).toContain("Shown in emails and titles.");
  expect(html).toContain("Save changes");
});

test("the general form has the +18 mode switch, with its help, as the setting is", async () => {
  const { html, names, shown } = await controls(GeneralForm);
  expect(names.has("adultMode")).toBe(true);
  expect(shown).toContain("adultMode");
  expect(html).toContain(messages.adminSetup.fields.adultMode.help);
  expect(html).not.toMatch(/<input[^>]*name="adultMode"[^>]*checked/);
});

test("the +18 mode's help is two short sentences in every language: what it does, and what off means", async () => {
  const { messagesFor } = await import("@/i18n/messages");
  for (const locale of ["en", "es"] as const) {
    const help = (await messagesFor(locale)).adminSetup.fields.adultMode.help;
    expect(help.split(/(?<=\.)\s+/), locale).toHaveLength(2);
    expect(help.split(/\s+/).length, locale).toBeLessThanOrEqual(30);
  }
});

test("the new-member, search engine and cookie forms keep their settings", async () => {
  const members = await controls(MembersForm);
  expect([...members.names].sort()).toEqual([
    "approveSignups",
    "firstPostsToModerate",
    "minimumAge",
    "moderateLinksFromNewMembers",
    "newMemberDays",
    "newMemberMentionLimit",
    "registrationFields",
    "registrationOpen",
    "requireEmailConfirmation",
    "welcomeMessage.body",
    "welcomeMessage.enabled",
    "welcomeMessage.sender",
    "welcomeMessage.subject",
  ]);
  // The list of required fields and the welcome message are replaced whole, so the form says it
  // showed them.
  expect(members.shown).toContain("registrationFields");
  expect(members.shown).toContain("welcomeMessage");
  expect(members.html).toContain('value="birthday"');
  expect([...(await controls(SeoForm)).names].sort()).toEqual([
    "indexNowKey",
    "nodeTitleTemplate",
    "profileTitleTemplate",
    "threadTitleTemplate",
  ]);
  const cookies = await controls(CookiesForm);
  expect([...cookies.names].sort()).toEqual(["cookieBannerOutsideEu"]);
  // The ask-again step is still on the page, apart from the form.
  expect(cookies.html).toContain("Ask everyone again");
});

test("the anti-spam form keeps the limits, the three rules, the signature formats and the guest check", async () => {
  const { names, shown } = await controls(AntispamForm);
  for (const name of [
    "floodSeconds",
    "linksRule",
    "approvalRule",
    "signatureMaxLength",
    "signatureMaxLines",
    "signatureMaxLinks",
    "signatureMaxImages",
    "signatureMaxSmilies",
    "signatureMaxTextSize",
    "signatureFormats",
    "signatureRule",
    "turnstileEnabled",
    "turnstileSiteKey",
    "turnstileSecret",
    "turnstileForms",
  ])
    expect(names.has(name), name).toBe(true);
  for (const key of ["linksRule", "approvalRule", "signatureRule"])
    expect(shown, key).toContain(key);
});

test("the uploads and levels forms keep the size, the types, the group storage, the titles and the standing", async () => {
  const uploads = await controls(UploadsForm);
  for (const name of [
    "maxUploadBytes",
    "allowedUploadTypes.avatar",
    "groupUploadLimitBytes.2",
  ])
    expect(uploads.names.has(name), name).toBe(true);
  const levels = await controls(LevelsForm);
  for (const name of [
    "levelStep",
    "levelTitles.0.level",
    "levelTitles.0.title",
    "levelTitles.3.title",
    "customTitleMaxLength",
    "standingPostPoints",
    "standingReactionsPerPoint",
    "standingReferralPoints",
    "standingExcludeStaff",
    "standingExcludedUserIds",
    "standingExcludeRule",
  ])
    expect(levels.names.has(name), name).toBe(true);
  for (const key of [
    "levelTitles",
    "standingExcludedUserIds",
    "standingExcludeRule",
  ])
    expect(levels.shown, key).toContain(key);
});

test("the new-member form shows the stored welcome message, its sender by username", async () => {
  backend = fakeBackend({
    ...answers,
    "users.cards": () =>
      Response.json({
        items: [
          {
            id: 7,
            username: "Ada",
            avatar: null,
            frame: null,
            nameColor: null,
            nameIcon: null,
            title: "",
            badges: [],
            level: 1,
            restricted: false,
          },
        ],
      }),
  });
  const html = await new Response(
    await renderToReadableStream(withIntl(await MembersForm())),
  ).text();
  expect(html).toMatch(/<input[^>]*name="welcomeMessage.enabled"[^>]*checked/);
  expect(html).toMatch(/name="welcomeMessage.sender"[^>]*value="Ada"/);
  expect(html).toContain('value="Hello {name}"');
  expect(html).toContain("Welcome, {name}!");
});

test("the home page form keeps the rules, the fallback and the forums left out", async () => {
  const { names, shown } = await controls(HomeForm);
  for (const name of [
    "homeTab.rules.0.tab",
    "homeTab.rules.0.position",
    "homeTab.fallback",
  ])
    expect(names.has(name), name).toBe(true);
  for (const key of ["homeTab", "feedExcludedForumIds"])
    expect(shown, key).toContain(key);
});

const TYPE = {
  id: 1,
  name: "Spam",
  nameEn: "Spam",
  nameEs: "Correo basura",
  points: 2,
  expiryDays: 30,
  defaultReason: "",
  locked: false,
};
const ACTION = {
  id: 1,
  threshold: 5,
  kind: "ban",
  days: null,
  groupId: null,
  groupTitle: null,
  restrictionKind: null,
} as const;

test("the warning type and action forms keep their fields, a change naming its record", async () => {
  const fresh = await controls(() => TypeForm({}));
  const change = await controls(() => TypeForm({ type: TYPE }));
  for (const name of [
    "nameEn",
    "nameEs",
    "points",
    "expiryDays",
    "defaultReason",
    "locked",
  ]) {
    expect(fresh.names.has(name), name).toBe(true);
    expect(change.names.has(name), name).toBe(true);
  }
  expect(fresh.names.has("id")).toBe(false);
  expect(change.html).toContain('name="id" value="1"');
  expect(fresh.html).toContain("Create warning type");
  const newAction = await controls(() => ActionForm({ groups: null }));
  const changeAction = await controls(() =>
    ActionForm({ action: ACTION, groups: null }),
  );
  for (const name of [
    "threshold",
    "kind",
    "days",
    "permanent",
    "groupId",
    "restrictionKind",
    "actorPassword",
  ]) {
    expect(newAction.names.has(name), name).toBe(true);
    expect(changeAction.names.has(name), name).toBe(true);
  }
  expect(newAction.names.has("id")).toBe(false);
  expect(changeAction.html).toContain('name="id" value="1"');
});

test("the warning lists have a row per record leading to its page, with the delete step and no form", async () => {
  const types = await controls(WarningTypes);
  expect(types.html).toContain('href="/admin/settings/warnings/types/1"');
  expect(types.html).toContain("Spam");
  expect(types.html.match(/name="id" value="1"/g)).toHaveLength(1);
  expect(types.names.has("nameEn")).toBe(false);
  const actions = await controls(WarningActions);
  expect(actions.html).toContain('href="/admin/settings/warnings/actions/1"');
  expect(actions.html.match(/name="id" value="1"/g)).toHaveLength(1);
  expect(actions.names.has("threshold")).toBe(false);
});

// The message at a full key, if it is one.
function messageAt(key: string) {
  let value: unknown = messages;
  for (const part of key.split("."))
    value = (value as Record<string, unknown> | undefined)?.[part];
  return value;
}

// The rows that hold a secret: written, never shown, so there is nothing in them to find. The
// search leaves them out and does not name them (tests/turnstile-scope.test.ts).
const WRITE_ONLY = new Set(["turnstileSecret"]);

test("every row a settings form draws is found by the panel's search, at the screen that shows it", async () => {
  const forms = {
    setupGeneral: GeneralForm,
    setupHome: HomeForm,
    setupMembers: MembersForm,
    setupAntispam: AntispamForm,
    setupUploads: UploadsForm,
    setupSeo: SeoForm,
    setupIdentity: IdentityForm,
    setupLevels: LevelsForm,
    setupCookies: CookiesForm,
  } satisfies Record<keyof typeof SETTING_ROWS, unknown>;
  const everyRow = new Set<string>();
  for (const [screen, form] of Object.entries(forms)) {
    const { html } = await controls(form);
    const drawn = [...html.matchAll(/data-field="([^"]+)"/g)].map(
      ([, name]) => name,
    );
    for (const name of drawn) everyRow.add(name);
    expect(drawn.length, screen).toBeGreaterThan(0);
    const groups = SETTING_ROWS[screen as keyof typeof SETTING_ROWS];
    const rows = groups.flatMap((group) => group.rows.map(rowText));
    for (const { legend } of groups)
      expect(messageAt(legend), legend).toBeString();
    const covers = (row: { name: string }, name: string) =>
      name === row.name || name.startsWith(`${row.name}.`);
    for (const name of drawn.filter((name) => !WRITE_ONLY.has(name)))
      expect(
        rows.some((row) => covers(row, name)),
        `${screen} draws ${name}, which the search does not list`,
      ).toBe(true);
    for (const row of rows) {
      expect(WRITE_ONLY.has(row.name), row.name).toBe(false);
      expect(
        drawn.some((name) => covers(row, name)),
        `${screen} does not draw ${row.name}`,
      ).toBe(true);
      expect(messageAt(row.label), row.label).toBeString();
      expect(messageAt(row.label), row.label).not.toBe("");
      if (row.help) expect(messageAt(row.help), row.help).toBeString();
    }
  }
  // The rows left out are still on their screens: the exception names real rows.
  for (const name of WRITE_ONLY) expect(everyRow.has(name), name).toBe(true);
});
