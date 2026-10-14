"use client";

// Settings that save on their own, for the rows of a settings screen (SettingsRow). The rules of
// saving (pause, one save at a time, undo window) are in lib/autosave.ts; these wire them to a form.
//
//   AutosaveForm   Text fields. They save after a short pause in typing and when a field is left;
//                  a choice from a list saves at once. Emptying a setting that had text offers
//                  an Undo for a few seconds.
//   ChoiceForm     A set of submit buttons named "value": pressing one saves it.
//   SaveStatus     The small state beside a row: saving, saved, the refusal, and Undo.
//   useAutosave    The same for a row that is neither (a picture): `perform` runs any save.
//
// `action` takes the fields as FormData and answers { ok: true } or { error } with the backend's
// message; it must not redirect.

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { SettingsRow } from "@/components/forum/settings";
import {
  type Autosave,
  createAutosave,
  type Entries,
  IDLE,
  type SaveResult,
  type SaveState,
} from "@/lib/autosave";
import { cn } from "@/lib/utils";

type Action = (data: FormData) => Promise<SaveResult>;

const toFormData = (entries: Entries) => {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
};

const entriesOf = (data: FormData): Entries =>
  [...data.entries()].flatMap(([name, value]) =>
    typeof value === "string" ? [[name, value] as const] : [],
  );

export function useAutosave(options: {
  save?: (entries: Entries) => Promise<SaveResult>;
  read?: () => Entries;
  write?: (entries: Entries) => void;
}): { state: SaveState; autosave: Autosave } {
  const [state, setState] = useState<SaveState>(IDLE);
  // The latest handlers, so the one controller made on the first render never goes stale.
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const [autosave] = useState(() =>
    createAutosave({
      save: async (entries) =>
        (await latest.current.save?.(entries)) ?? { ok: true },
      read: () => latest.current.read?.() ?? [],
      write: (entries) => latest.current.write?.(entries),
      onState: setState,
    }),
  );
  useEffect(() => () => autosave.dispose(), [autosave]);
  return { state, autosave };
}

export function SaveStatus({
  state,
  onUndo,
}: {
  state: SaveState;
  onUndo?: () => void;
}) {
  const t = useTranslations("forum.autosave");
  return (
    <output
      aria-live="polite"
      className={cn(
        "flex min-h-6 max-w-full items-center gap-2 text-xs font-medium [overflow-wrap:anywhere]",
        state.phase === "saving" && "text-muted-foreground",
        state.phase === "saved" && "text-success",
        state.phase === "error" && "text-destructive",
      )}
    >
      {state.phase === "saving" && t("saving")}
      {state.phase === "saved" && (
        <>
          <Check aria-hidden="true" className="size-3.5" />
          {t("saved")}
          {state.undo && onUndo && (
            <button
              type="button"
              onClick={onUndo}
              className="inline-flex min-h-10 items-center px-1 font-semibold text-primary-ink underline-offset-4 hover:underline md:min-h-6"
            >
              {t("undo")}
            </button>
          )}
        </>
      )}
      {state.phase === "error" && (state.message || t("failed"))}
    </output>
  );
}

export function AutosaveForm({
  action,
  title,
  description,
  htmlFor,
  id,
  children,
}: {
  action: Action;
  title: React.ReactNode;
  description?: React.ReactNode;
  htmlFor?: string;
  id?: string;
  children: React.ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  const read = (): Entries =>
    form.current ? entriesOf(new FormData(form.current)) : [];
  const { state, autosave } = useAutosave({
    save: (entries) => action(toFormData(entries)),
    read,
    write: (entries) => {
      for (const [name, value] of entries) {
        const field = form.current?.elements.namedItem(name);
        if (
          field instanceof HTMLInputElement ||
          field instanceof HTMLTextAreaElement ||
          field instanceof HTMLSelectElement
        ) {
          field.value = value;
        }
      }
    },
  });
  // What the fields hold when the row first shows is what is saved.
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once, on the first render
  useEffect(() => {
    autosave.baseline(read());
  }, [autosave]);
  return (
    <form
      ref={form}
      onSubmit={(event) => {
        event.preventDefault();
        void autosave.flush();
      }}
      onChange={(event) => {
        if (event.target instanceof HTMLSelectElement) void autosave.flush();
        else autosave.edit();
      }}
      onBlur={(event) => {
        // Moving between the fields of one row is not leaving it.
        if (!event.currentTarget.contains(event.relatedTarget)) {
          void autosave.flush();
        }
      }}
      aria-busy={state.phase === "saving"}
    >
      <SettingsRow
        id={id}
        title={title}
        description={description}
        htmlFor={htmlFor}
        status={
          <SaveStatus state={state} onUndo={() => void autosave.undo()} />
        }
      >
        {children}
      </SettingsRow>
    </form>
  );
}

export function ChoiceForm({
  action,
  title,
  description,
  id,
  children,
}: {
  action: Action;
  title: React.ReactNode;
  description?: React.ReactNode;
  id?: string;
  children: React.ReactNode;
}) {
  const { state, autosave } = useAutosave({
    save: (entries) => action(toFormData(entries)),
  });
  return (
    <form
      action={async (data) => {
        await autosave.saveNow(entriesOf(data));
      }}
      aria-busy={state.phase === "saving"}
    >
      <SettingsRow
        id={id}
        title={title}
        description={description}
        status={<SaveStatus state={state} />}
      >
        {children}
      </SettingsRow>
    </form>
  );
}
