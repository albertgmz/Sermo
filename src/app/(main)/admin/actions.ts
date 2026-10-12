"use server";

import { notFound, redirect } from "next/navigation";
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

  const title = text(formData, "title");
  const description = text(formData, "description");
  const identifier = text(formData, "identifier");
  if (title.length < 2 || title.length > 80) {
    return {
      field: "title",
      error: "Enter a forum name between 2 and 80 characters.",
    };
  }
  if (!description || description.length > 300) {
    return {
      field: "description",
      error: "Enter a description between 1 and 300 characters.",
    };
  }
  if (
    typeof formData.get("identifier") !== "string" ||
    identifier.length > 64 ||
    (identifier && !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(identifier))
  ) {
    return {
      field: "identifier",
      error:
        "Use up to 64 lowercase letters, numbers and single hyphens, starting with a letter. Or leave this blank to use the numeric ID.",
    };
  }
  if (
    identifier &&
    forums.some((forum) => forum.id !== forumId && forum.slug === identifier)
  ) {
    return {
      field: "identifier",
      error: "Another forum already uses this URL identifier.",
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

  const name = text(formData, "siteName");
  const description = text(formData, "description");
  if (name.length < 2 || name.length > 60) {
    return {
      field: "siteName",
      error: "Enter a site name between 2 and 60 characters.",
    };
  }
  if (!description || description.length > 300) {
    return {
      field: "description",
      error: "Enter a description between 1 and 300 characters.",
    };
  }
  const registration = formData.getAll("registration");
  if (
    registration.length > 1 ||
    (registration.length === 1 && registration[0] !== "on")
  ) {
    return {
      field: "registration",
      error: "Choose whether new members can register.",
    };
  }

  redirect("/admin/settings?notice=demo");
}
