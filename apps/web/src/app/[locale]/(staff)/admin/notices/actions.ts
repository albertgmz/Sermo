"use server";

import {
  noticesCreate,
  noticesDelete,
  noticesUpdate,
} from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { formFailure, ruleOf, text } from "../groups/form-errors";
import { dateValue } from "./dates";

const FIELDS = ["title", "body", "rule", "startsAt", "endsAt"];

type Parsed = z.input<typeof noticesCreate.input>;

// The fields of the form as the backend takes them, or the state to show when one is not usable.
async function fields(
  formData: FormData,
): Promise<Parsed | { fields: Record<string, string> }> {
  const t = await getTranslations("adminCommunication.errors");
  const rule = ruleOf(formData);
  if (rule === null) return { fields: { rule: t("rule") } };
  const startsAt = dateValue(text(formData, "startsAt"));
  if (startsAt === undefined) return { fields: { startsAt: t("date") } };
  const endsAt = dateValue(text(formData, "endsAt"));
  if (endsAt === undefined) return { fields: { endsAt: t("date") } };
  return {
    title: text(formData, "title"),
    // A browser sends the line breaks of a text area as CRLF; the source is kept with LF.
    body: text(formData, "body").replaceAll("\r\n", "\n"),
    rule,
    dismissible: formData.get("dismissible") !== null,
    active: formData.get("active") !== null,
    startsAt,
    endsAt,
  };
}

export async function createNotice(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const input = await fields(formData);
  if ("fields" in input) return input;
  try {
    await call(noticesCreate, input);
  } catch (error) {
    return formFailure(error, FIELDS);
  }
  redirect("/admin/notices?notice=created");
}

export async function saveNotice(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminCommunication.errors");
  const noticeId = parseId(text(formData, "id"));
  if (noticeId === null) return { error: t("id") };
  const input = await fields(formData);
  if ("fields" in input) return input;
  try {
    await call(noticesUpdate, { noticeId, ...input });
  } catch (error) {
    return formFailure(error, FIELDS);
  }
  redirect(`/admin/notices/${noticeId}?notice=saved`);
}

export async function removeNotice(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminCommunication.errors");
  const noticeId = parseId(text(formData, "id"));
  if (noticeId === null) return { error: t("id") };
  try {
    await call(noticesDelete, { noticeId });
  } catch (error) {
    return formFailure(error, []);
  }
  redirect("/admin/notices?notice=removed");
}
