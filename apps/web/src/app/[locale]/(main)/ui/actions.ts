"use server";

import { createElement, type ReactNode } from "react";
import { requireStyleguide } from "@/app/[locale]/(main)/ui/guard";
import type { ActionFormState } from "@/components/forum/action-form";
import type { LineComposerState } from "@/components/forum/line-composer";
import { Markdown } from "@/components/forum/markdown";
import type { StaffFormState } from "@/components/staff/form-rows";

export async function discard(_formData: FormData) {
  await requireStyleguide();
}

// The styleguide's one-line composer: refuses an empty line as a backend would, otherwise takes
// it and stores nothing.
export async function discardLine(
  _previous: LineComposerState,
  formData: FormData,
): Promise<LineComposerState> {
  await requireStyleguide();
  return String(formData.get("body") ?? "").trim()
    ? {}
    : { error: "Write something first." };
}

// The styleguide's delete and report forms: take the form and store nothing.
export async function discardForm(): Promise<ActionFormState> {
  await requireStyleguide();
  return { done: true };
}

// The styleguide's quote button: there is nothing to quote.
export async function discardQuote(): Promise<null> {
  await requireStyleguide();
  return null;
}

export async function echoMarkdown(_previous: ReactNode, formData: FormData) {
  await requireStyleguide();
  const body = String(formData.get("body") ?? "");
  return body ? createElement(Markdown, null, body) : null;
}

// The styleguide's form rows: refuses an empty title by field, otherwise confirms and stores
// nothing.
export async function saveSample(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  await requireStyleguide();
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
  await requireStyleguide();
  if (formData.get("actorPassword") === "wrong") {
    return { fields: { actorPassword: "That is not your password." } };
  }
  return { notice: "Done. The styleguide changes nothing." };
}
