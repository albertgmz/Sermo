"use server";

import {
  REGISTRATION_FIELDS,
  SIGNATURE_FORMATS,
  settingsGet,
  TURNSTILE_FORMS,
  usersSearch,
} from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { invalidArgument } from "@/lib/sermo/outcome";
import { ruleOf, ruleRefusal, text, whole } from "../groups/form-errors";
import {
  type Parsed,
  type Spec,
  saveSettings,
  scalars,
  shownKeys,
} from "./save";

// One action per screen, each sending only the top-level keys its form shows. A key that holds a
// map or a list is sent whole: the backend replaces it, so what the form leaves alone is taken
// from a fresh read and sent back unchanged.

const knownIn =
  (spec: Spec, ...prefixes: string[]) =>
  (name: string) =>
    name in spec || prefixes.some((prefix) => name.startsWith(`${prefix}.`));

const GENERAL: Spec = {
  siteName: "text",
  siteDescription: "text",
  defaultLanguage: "language",
  profilePostsEnabled: "bool",
  adultMode: "bool",
};

// The analytics setting is one nested object, sent whole by a form that showed it: the provider
// and the fields that provider uses.
async function analyticsFrom(
  formData: FormData,
  parsed: Parsed,
): Promise<Record<string, unknown> | null> {
  const t = await getTranslations("adminSetup.errors");
  const provider = text(formData, "analytics.provider");
  if (provider === "none") return { provider };
  if (provider === "matomo") {
    const siteId = whole(text(formData, "analytics.siteId"));
    if (siteId === null) parsed.fields["analytics.siteId"] = t("number");
    return {
      provider,
      url: text(formData, "analytics.url").trim(),
      siteId,
    };
  }
  if (provider === "google") {
    return {
      provider,
      measurementId: text(formData, "analytics.measurementId").trim(),
    };
  }
  return null;
}

export async function saveGeneral(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const parsed = await scalars(GENERAL, formData);
  if (parsed.refused) return { error: await invalidArgument() };
  const current = (await call(settingsGet, {})).socialLinks;
  const socialLinks: Record<string, string | null> = { ...current };
  for (const network of Object.keys(current)) {
    const typed = formData.get(`socialLinks.${network}`);
    if (typeof typed === "string") socialLinks[network] = typed.trim() || null;
  }
  parsed.body.socialLinks = socialLinks;
  if (shownKeys(formData).has("analytics")) {
    const analytics = await analyticsFrom(formData, parsed);
    if (analytics === null) return { error: await invalidArgument() };
    parsed.body.analytics = analytics;
  }
  return saveSettings(parsed, {
    back: "/admin/settings",
    known: knownIn(GENERAL, "socialLinks", "analytics"),
    site: true,
  });
}

const MEMBERS: Spec = {
  newMemberDays: "int",
  firstPostsToModerate: "int",
  moderateLinksFromNewMembers: "bool",
  approveSignups: "bool",
  registrationOpen: "bool",
  requireEmailConfirmation: "bool",
  minimumAge: "int",
  newMemberMentionLimit: "int",
};

// The required profile fields are a list ticked in the form: replaced whole, so read only when the
// form showed it.
export async function saveMembers(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const parsed = await scalars(MEMBERS, formData);
  if (parsed.refused) return { error: await invalidArgument() };
  if (shownKeys(formData).has("registrationFields")) {
    const ticked = new Set(formData.getAll("registrationFields"));
    parsed.body.registrationFields = REGISTRATION_FIELDS.filter((field) =>
      ticked.has(field),
    );
  }
  // The welcome message is one nested setting, replaced whole by a form that showed it. Its
  // sender is typed as a username and sent as an id; empty is the first administrator.
  if (shownKeys(formData).has("welcomeMessage")) {
    const t = await getTranslations("adminSetup.errors");
    const typed = text(formData, "welcomeMessage.sender").trim();
    const senderId = typed === "" ? null : await memberId(typed);
    if (typed !== "" && senderId === null)
      parsed.fields["welcomeMessage.sender"] = t("unknownMembers", {
        names: typed,
      });
    parsed.body.welcomeMessage = {
      enabled: formData.get("welcomeMessage.enabled") !== null,
      senderId,
      subject: text(formData, "welcomeMessage.subject"),
      body: text(formData, "welcomeMessage.body"),
    };
  }
  return saveSettings(parsed, {
    back: "/admin/settings/members",
    known: (name) =>
      name in MEMBERS ||
      name === "registrationFields" ||
      /^welcomeMessage\.(sender|subject|body)$/.test(name),
    rename: (path) =>
      path[0] === "welcomeMessage" && path[1] === "senderId"
        ? ["welcomeMessage", "sender"]
        : path,
    // The sign-up page and the login page read the registration rules from the cached site.
    site: true,
  });
}

const ANTISPAM: Spec = {
  floodSeconds: "int",
  signatureMaxLength: "int",
  signatureMaxLines: "int",
  signatureMaxLinks: "int",
  signatureMaxImages: "int",
  signatureMaxSmilies: "int",
  signatureMaxTextSize: "int",
  turnstileEnabled: "bool",
  turnstileSiteKey: "text",
};
const ANTISPAM_RULES = ["linksRule", "approvalRule", "signatureRule"];
// Lists of kinds ticked in the form: replaced whole, so each is read only when the form showed it.
const ANTISPAM_LISTS = {
  signatureFormats: SIGNATURE_FORMATS,
  turnstileForms: TURNSTILE_FORMS,
} as const;

// The rules and the lists are replaced whole, so each is read only when the form showed it. The
// Turnstile secret is write-only: typing one replaces it, the box removes it, and a form that does
// neither leaves it alone.
export async function saveAntispam(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const parsed = await scalars(ANTISPAM, formData);
  if (parsed.refused) return { error: await invalidArgument() };
  const shown = shownKeys(formData);
  for (const [name, kinds] of Object.entries(ANTISPAM_LISTS)) {
    if (!shown.has(name)) continue;
    const ticked = new Set(formData.getAll(name));
    parsed.body[name] = kinds.filter((kind) => ticked.has(kind));
  }
  if (shown.has("turnstileSecret")) {
    const typed = text(formData, "turnstileSecret").trim();
    if (typed !== "") parsed.body.turnstileSecret = typed;
    else if (formData.get("turnstileSecretRemove") !== null)
      parsed.body.turnstileSecret = null;
  }
  for (const name of ANTISPAM_RULES) {
    if (!shown.has(name)) continue;
    const rule = ruleOf(formData, name);
    if (rule === null)
      Object.assign(parsed.fields, (await ruleRefusal(formData, name)).fields);
    else parsed.body[name] = rule;
  }
  return saveSettings(parsed, {
    back: "/admin/settings/antispam",
    known: (name) =>
      name in ANTISPAM ||
      name in ANTISPAM_LISTS ||
      ANTISPAM_RULES.includes(name) ||
      name === "turnstileSecret",
    // The public site shows the widget of the forms it guards.
    site: true,
  });
}

const SEO: Spec = {
  threadTitleTemplate: "text",
  nodeTitleTemplate: "text",
  profileTitleTemplate: "text",
  indexNowKey: "nullText",
};

export async function saveSeo(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  return saveSettings(await scalars(SEO, formData), {
    back: "/admin/settings/seo",
    known: knownIn(SEO),
  });
}

const UPLOADS: Spec = { maxUploadBytes: "int" };

// A list of content types typed one per line (commas and spaces also separate).
const types = (raw: string) => raw.split(/[\s,]+/).filter(Boolean);

export async function saveUploads(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminSetup.errors");
  const parsed: Parsed = await scalars(UPLOADS, formData);
  if (parsed.refused) return { error: await invalidArgument() };
  const current = await call(settingsGet, {});

  // The purposes are the ones the backend returned; a purpose the form did not show keeps its list.
  const allowed: Record<string, string[]> = { ...current.allowedUploadTypes };
  for (const purpose of Object.keys(allowed)) {
    const typed = formData.get(`allowedUploadTypes.${purpose}`);
    if (typeof typed === "string") allowed[purpose] = types(typed);
  }
  parsed.body.allowedUploadTypes = allowed;

  // The whole map: every group the form showed is replaced by what was typed (empty is
  // unlimited, so the key goes), every other group keeps its stored limit.
  const limits: Record<string, number> = { ...current.groupUploadLimitBytes };
  const prefix = "groupUploadLimitBytes.";
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith(prefix) || typeof value !== "string") continue;
    const id = parseId(name.slice(prefix.length));
    if (id === null) return { error: t("id") };
    const key = String(id);
    if (value.trim() === "") {
      delete limits[key];
    } else {
      const bytes = whole(value);
      if (bytes === null) parsed.fields[name] = t("number");
      else limits[key] = bytes;
    }
  }
  parsed.body.groupUploadLimitBytes = limits;

  return saveSettings(parsed, {
    back: "/admin/settings/uploads",
    known: knownIn(UPLOADS, "allowedUploadTypes", "groupUploadLimitBytes"),
    // The upload routes read the size limit through the cached site.
    site: true,
  });
}

const LEVELS: Spec = {
  levelStep: "int",
  customTitleMaxLength: "int",
  standingPostPoints: "int",
  standingReactionsPerPoint: "int",
  standingReferralPoints: "int",
  standingExcludeStaff: "bool",
};

// The member names typed one per line or separated by commas (a name may hold spaces), each once.
const names = (raw: string) => [
  ...new Map(
    raw
      .split(/[\n,]+/)
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => [name.toLowerCase(), name] as const),
  ).values(),
];

// The id of the member with this exact username (any case), or null.
async function memberId(username: string): Promise<number | null> {
  const { items } = await call(usersSearch, { prefix: username, limit: 25 });
  const wanted = username.toLowerCase();
  return (
    items.find((item) => item.username.toLowerCase() === wanted)?.id ?? null
  );
}

export async function saveLevels(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminSetup.errors");
  const parsed = await scalars(LEVELS, formData);

  // The title rows, in the order of the form. A row with both fields empty is dropped; `rows`
  // remembers which form row each sent entry came from, for the backend's per-entry messages.
  const indexes = [
    ...new Set(
      [...formData.keys()]
        .map((name) => /^levelTitles\.(\d{1,3})\./.exec(name)?.[1])
        .filter((index): index is string => index !== undefined)
        .map(Number),
    ),
  ].sort((a, b) => a - b);
  const titles: { level: number; title: string }[] = [];
  const rows: number[] = [];
  const listShown = shownKeys(formData).has("levelTitles");
  for (const index of listShown ? indexes : []) {
    const level = text(formData, `levelTitles.${index}.level`).trim();
    const title = text(formData, `levelTitles.${index}.title`);
    if (level === "" && title.trim() === "") continue;
    const number = whole(level);
    if (number === null) parsed.fields[`levelTitles.${index}`] = t("number");
    else {
      titles.push({ level: number, title });
      rows.push(index);
    }
  }
  // The list is replaced as a whole, so only by a form that showed it.
  if (listShown) parsed.body.levelTitles = titles;

  // The members left out of the standings, typed as usernames and sent as ids.
  if (shownKeys(formData).has("standingExcludedUserIds")) {
    const found = await Promise.all(
      names(text(formData, "standingExcludedUserIds")).map(
        async (name) => [name, await memberId(name)] as const,
      ),
    );
    const unknown = found.filter(([, id]) => id === null).map(([name]) => name);
    if (unknown.length > 0)
      parsed.fields.standingExcludedUserIds = t("unknownMembers", {
        names: unknown.join(", "),
      });
    parsed.body.standingExcludedUserIds = found.flatMap(([, id]) =>
      id === null ? [] : [id],
    );
  }

  // The rule that leaves members out, replaced whole, so only by a form that showed it.
  if (shownKeys(formData).has("standingExcludeRule")) {
    const rule = ruleOf(formData, "standingExcludeRule");
    if (rule === null)
      Object.assign(
        parsed.fields,
        (await ruleRefusal(formData, "standingExcludeRule")).fields,
      );
    else parsed.body.standingExcludeRule = rule;
  }

  return saveSettings(parsed, {
    back: "/admin/settings/levels",
    known: (name) =>
      knownIn(LEVELS, "levelTitles")(name) ||
      name === "standingExcludedUserIds" ||
      name === "standingExcludeRule",
    rename: (path) =>
      path[0] === "levelTitles" && typeof path[1] === "number"
        ? ["levelTitles", rows[path[1]] ?? path[1]]
        : path,
  });
}

// The rules of the home tab, in the order of the form's rows and then by the position typed in
// each (equal positions keep the order of the rows). A row with no tab chosen is dropped; `rows`
// remembers which form row each sent rule came from, for the backend's per-rule messages. The
// rules and the fallback are replaced as a whole, so only by a form that showed them. The same
// screen holds the forums the feed leaves out for everyone, a list replaced as a whole too.
export async function saveHomeTab(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminSetup.errors");
  const parsed: Parsed = { body: {}, fields: {} };
  if (!shownKeys(formData).has("homeTab"))
    return { error: await invalidArgument() };
  const indexes = [
    ...new Set(
      [...formData.keys()]
        .map((name) => /^homeTab\.rules\.(\d{1,2})\./.exec(name)?.[1])
        .filter((index): index is string => index !== undefined)
        .map(Number),
    ),
  ].sort((a, b) => a - b);
  const entries: {
    rule: NonNullable<ReturnType<typeof ruleOf>>;
    tab: string;
    position: number;
    row: number;
  }[] = [];
  for (const row of indexes) {
    const tab = text(formData, `homeTab.rules.${row}.tab`);
    if (tab === "") continue;
    const name = `homeTab.rules.${row}.rule`;
    const rule = ruleOf(formData, name);
    if (rule === null) {
      Object.assign(parsed.fields, (await ruleRefusal(formData, name)).fields);
      continue;
    }
    const typed = text(formData, `homeTab.rules.${row}.position`);
    const position = whole(typed);
    if (typed.trim() !== "" && position === null)
      parsed.fields[`homeTab.rules.${row}.tab`] = t("number");
    entries.push({ rule, tab, position: position ?? row + 1, row });
  }
  entries.sort((a, b) => a.position - b.position || a.row - b.row);
  const rows = entries.map((entry) => entry.row);
  if (shownKeys(formData).has("feedExcludedForumIds")) {
    const ids = formData
      .getAll("feedExcludedForumIds")
      .map((value) => parseId(String(value)));
    if (ids.some((id) => id === null))
      return { error: await invalidArgument() };
    parsed.body.feedExcludedForumIds = ids;
  }
  parsed.body.homeTab = {
    rules: entries.map(({ rule, tab }) => ({ rule, tab })),
    fallback: text(formData, "homeTab.fallback"),
  };
  return saveSettings(parsed, {
    back: "/admin/settings/home",
    known: (name) =>
      name === "homeTab.fallback" ||
      name === "feedExcludedForumIds" ||
      /^homeTab\.rules\.\d+\.(rule|tab)$/.test(name),
    rename: (path) =>
      path[0] === "homeTab" &&
      path[1] === "rules" &&
      typeof path[2] === "number"
        ? ["homeTab", "rules", rows[path[2]] ?? path[2], ...path.slice(3)]
        : path,
    // Guests open the home page on the default the site shares, cached with the site.
    site: true,
  });
}
