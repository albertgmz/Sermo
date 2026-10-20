"use server";

import { createElement, type ReactNode } from "react";
import { requireStyleguide } from "@/app/[locale]/(main)/ui/guard";
import type { ActionFormState } from "@/components/forum/action-form";
import type { EarlierPage } from "@/components/forum/earlier-comments";
import type { LineComposerState } from "@/components/forum/line-composer";
import type { StaffFormState } from "@/components/staff/form-rows";
import type { SaveResult } from "@/lib/autosave";

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

// The styleguide's "show more comments": there are no older ones.
export async function noEarlierComments(
  _cursor: string | null,
  _through: number | null,
): Promise<EarlierPage> {
  await requireStyleguide();
  return { rows: [], cursor: null, done: true };
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

// The styleguide's editor form: shows the BB code the editor sent, as text.
export async function echoBbCode(_previous: ReactNode, formData: FormData) {
  await requireStyleguide();
  const body = String(formData.get("body") ?? "");
  return body
    ? createElement(
        "pre",
        { className: "overflow-x-auto font-mono text-xs whitespace-pre-wrap" },
        body,
      )
    : null;
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

// The styleguide's autosaving rows: refuses a value over twenty characters the way a backend
// would, otherwise takes it and stores nothing.
export async function saveSetting(formData: FormData): Promise<SaveResult> {
  await requireStyleguide();
  const long = [...formData.values()].some(
    (value) => String(value).length > 20,
  );
  return long ? { error: "Use 20 characters or fewer." } : { ok: true };
}
