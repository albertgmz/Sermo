import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { settingsGet } from "@sermo/core/contracts";
import { renderToReadableStream } from "react-dom/server";
import { CRITERIA_BODY } from "@/lib/test-criteria";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";
import { fakeBackend, refusal } from "../groups/test-backend";
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
const { TypeForm, WarningTypes } = await import("./warnings/warning-types");
const { ActionForm, WarningActions } = await import(
  "./warnings/warning-actions"
);

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next-intl", () => nextIntl);
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
    "analytics.url",
    "analytics.siteId",
    "analytics.measurementId",
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
  ]);
  // The list of required fields is replaced whole, so the form says it showed it.
  expect(members.shown).toContain("registrationFields");
  expect(members.html).toContain('value="birthday"');
  expect([...(await controls(SeoForm)).names].sort()).toEqual([
    "indexNowKey",
    "nodeTitleTemplate",
    "profileTitleTemplate",
    "threadTitleTemplate",
  ]);
  const cookies = await controls(CookiesForm);
  expect([...cookies.names].sort()).toEqual([
    "cookieBannerOutsideEu",
    "matomoCookieless",
  ]);
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
