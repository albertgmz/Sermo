"use server";

import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCategories } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export type DemoState = { field: string; error: string } | null;

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function previewForum(
  forumId: number,
  _previous: DemoState,
  formData: FormData,
): Promise<DemoState> {
  const user = await getCurrentUser();
  if (user?.role !== "admin") notFound();

  const forums = (await getCategories()).flatMap((category) => category.forums);
  if (!forums.some((forum) => forum.id === forumId)) notFound();

  const t = await getTranslations("admin.actions.errors");
  const title = text(formData, "title");
  const description = text(formData, "description");
  const identifier = text(formData, "identifier");
  if (title.length < 2 || title.length > 80) {
    return {
      field: "title",
      error: t("forumNameLength"),
    };
  }
  if (!description || description.length > 300) {
    return {
      field: "description",
      error: t("descriptionLength"),
    };
  }
  if (
    typeof formData.get("identifier") !== "string" ||
    identifier.length > 64 ||
    (identifier && !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(identifier))
  ) {
    return {
      field: "identifier",
      error: t("identifierFormat"),
    };
  }
  if (
    identifier &&
    forums.some((forum) => forum.id !== forumId && forum.slug === identifier)
  ) {
    return {
      field: "identifier",
      error: t("identifierTaken"),
    };
  }

  redirect(`/admin/forums/${forumId}?notice=demo`);
}

export async function previewSettings(
  _previous: DemoState,
  formData: FormData,
): Promise<DemoState> {
  const user = await getCurrentUser();
  if (user?.role !== "admin") notFound();

  const t = await getTranslations("admin.actions.errors");
  const name = text(formData, "siteName");
  const description = text(formData, "description");
  if (name.length < 2 || name.length > 60) {
    return {
      field: "siteName",
      error: t("siteNameLength"),
    };
  }
  if (!description || description.length > 300) {
    return {
      field: "description",
      error: t("descriptionLength"),
    };
  }
  const registration = formData.getAll("registration");
  if (
    registration.length > 1 ||
    (registration.length === 1 && registration[0] !== "on")
  ) {
    return {
      field: "registration",
      error: t("registrationInvalid"),
    };
  }

  redirect("/admin/settings?notice=demo");
}
