"use server";

import { pagesDelete, pagesSave } from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { formFailure, text } from "../groups/form-errors";

const FIELDS = ["slug", "title", "body", "isPublished", "newVersion"];

// A browser sends the line breaks of a text area as CRLF; the source is kept with LF, so what is
// saved reads back as the same text however it was posted.
const source = (raw: string) => raw.replaceAll("\r\n", "\n");

async function save(formData: FormData): Promise<StaffFormState | string> {
  try {
    const page = await call(pagesSave, {
      slug: text(formData, "slug"),
      title: text(formData, "title"),
      body: source(text(formData, "body")),
      isPublished: formData.get("isPublished") !== null,
      newVersion: formData.get("newVersion") !== null,
    });
    return page.slug;
  } catch (error) {
    return formFailure(error, FIELDS);
  }
}

// A new page: the slug comes from the form and the backend checks it.
export async function createPage(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const saved = await save(formData);
  if (typeof saved !== "string") return saved;
  redirect(`/admin/pages/${saved}?notice=created`);
}

// An existing page: the slug is the one in the address, sent as a hidden field.
export async function savePage(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const saved = await save(formData);
  if (typeof saved !== "string") return saved;
  redirect(`/admin/pages/${saved}?notice=saved`);
}

export async function deletePage(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminContent.errors");
  const slug = text(formData, "id");
  if (slug === "") return { error: t("id") };
  try {
    await call(pagesDelete, { slug });
  } catch (error) {
    return formFailure(error, []);
  }
  redirect("/admin/pages?notice=deleted");
}
