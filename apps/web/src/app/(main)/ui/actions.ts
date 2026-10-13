"use server";

import { createElement, type ReactNode } from "react";
import { Markdown } from "@/components/forum/markdown";
import type { StaffFormState } from "@/components/staff/form-rows";

export async function discard(_formData: FormData) {}

export async function echoMarkdown(_previous: ReactNode, formData: FormData) {
  const body = String(formData.get("body") ?? "");
  return body ? createElement(Markdown, null, body) : null;
}

// The styleguide's form rows: refuses an empty title by field, otherwise confirms and stores
// nothing.
export async function saveSample(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  await new Promise((resolve) => setTimeout(resolve, 600));
  if (!String(formData.get("title") ?? "").trim()) {
    return {
      error: "The sample was not saved.",
      fields: { title: "Enter a title." },
    };
  }
  return { notice: "Saved. The styleguide stores nothing." };
}

// The styleguide's confirmation step: refuses the password "wrong" under its field, otherwise
// confirms and changes nothing.
export async function confirmSample(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  await new Promise((resolve) => setTimeout(resolve, 600));
  if (formData.get("actorPassword") === "wrong") {
    return { fields: { actorPassword: "That is not your password." } };
  }
  return { notice: "Done. The styleguide changes nothing." };
}
