"use server";

import { settingsGet } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { invalidArgument } from "@/lib/sermo/outcome";
import { text, whole } from "../groups/form-errors";
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
  forumStatsEnabled: "bool",
};

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
  return saveSettings(parsed, {
    back: "/admin/settings",
    known: knownIn(GENERAL, "socialLinks"),
    site: true,
  });
}

const MEMBERS: Spec = {
  newMemberDays: "int",
  firstPostsToModerate: "int",
  moderateLinksFromNewMembers: "bool",
  newMemberMentionLimit: "int",
};

export async function saveMembers(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  return saveSettings(await scalars(MEMBERS, formData), {
    back: "/admin/settings/members",
    known: knownIn(MEMBERS),
  });
}

const WARNINGS: Spec = { warningBanThreshold: "int", warningBanDays: "int" };

export async function saveWarnings(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  return saveSettings(await scalars(WARNINGS, formData), {
    back: "/admin/settings/warnings",
    known: knownIn(WARNINGS),
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
  signatureMaxLength: "int",
  signatureMaxLines: "int",
  customTitleMaxLength: "int",
  standingPostPoints: "int",
  standingReactionsPerPoint: "int",
  standingReferralPoints: "int",
};

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

  return saveSettings(parsed, {
    back: "/admin/settings/levels",
    known: knownIn(LEVELS, "levelTitles"),
    rename: (path) =>
      path[0] === "levelTitles" && typeof path[1] === "number"
        ? ["levelTitles", rows[path[1]] ?? path[1]]
        : path,
  });
}
