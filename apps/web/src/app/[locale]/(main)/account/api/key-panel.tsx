"use client";

import { KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  issueKey,
  type KeyFormState,
  revokeKey,
} from "@/app/[locale]/(main)/account/api/actions";
import { CopyButton } from "@/components/forum/copy-button";
import { ConfirmPassword } from "@/components/staff/confirm-password";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { SubmitButton } from "@/components/staff/submit-button";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// One key as the page shows it; `created` is already formatted for the reader.
export type KeyRow = {
  id: string;
  name: string | null;
  createdAt: string;
  created: string;
};

// The member's key, or the form that makes one. A key made here is shown once, in place of the
// whole panel, until the member says they saved it. The action's answer already carries the page
// read again, so the rows behind it name the new key.
export function KeyPanel({ keys }: { keys: KeyRow[] }) {
  const t = useTranslations("account.apiKeys.key");
  const [state, action] = useActionState<KeyFormState, FormData>(
    issueKey,
    null,
  );
  const [saved, setSaved] = useState<string | null>(null);
  // Shown once means not again on Back: the router keeps a page left behind mounted but hidden,
  // with its state, and hiding it runs this cleanup. The hide waits a moment because a remount in
  // development (Strict Mode) runs the cleanup and the effect again at once, and must keep the key.
  const pendingHide = useRef<ReturnType<typeof setTimeout>>(undefined);
  const shownKey = state?.key;
  useLayoutEffect(() => {
    clearTimeout(pendingHide.current);
    if (!shownKey) return;
    // Nor after a full navigation away and Back: a browser may restore the whole page from its
    // back/forward cache, so the key is taken off the page, at once, as the page is left.
    const leave = () => flushSync(() => setSaved(shownKey));
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      pendingHide.current = setTimeout(() => setSaved(shownKey));
    };
  }, [shownKey]);

  if (state?.key && state.key !== saved) {
    return (
      <NewKey value={state.key} onDone={() => setSaved(state.key ?? null)} />
    );
  }

  const issue = (
    <form action={action} className="space-y-3">
      {keys.length > 0 && <input type="hidden" name="replace" value="1" />}
      <ConfirmPassword
        id="api-key-password"
        error={state?.fields?.actorPassword}
      />
      <output className="block px-4 text-xs font-medium text-destructive empty:hidden">
        {state?.error}
      </output>
      <div className="px-4 pb-4">
        <SubmitButton
          label={keys.length ? t("replaceSubmit") : t("create")}
          pendingLabel={keys.length ? t("replacing") : t("creating")}
        />
      </div>
    </form>
  );

  if (!keys.length) {
    return (
      <>
        <p className="p-4 text-sm text-muted-foreground">{t("none")}</p>
        <div className="border-t">{issue}</div>
      </>
    );
  }

  return (
    <>
      {keys.length > 1 && (
        <p className="border-b p-4 text-sm text-pretty">
          {t("several", { count: keys.length })}
        </p>
      )}
      <ul className="divide-y">
        {keys.map((key) => (
          <li
            key={key.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
          >
            <KeyRound
              aria-hidden="true"
              className="size-5 shrink-0 text-muted-foreground"
            />
            <div className="min-w-0 flex-1 basis-40">
              <p className="text-sm font-medium break-words">
                {key.name ?? t("unnamed")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t.rich("created", {
                  date: key.created,
                  time: (chunks) => (
                    <time dateTime={key.createdAt}>{chunks}</time>
                  ),
                })}
              </p>
            </div>
            <ConfirmStep
              action={revokeKey}
              fields={{ key: key.id }}
              summary={t("revoke")}
              warning={t("revokeWarning")}
              submit={t("revokeSubmit")}
              pendingLabel={t("revoking")}
            />
          </li>
        ))}
      </ul>
      <details
        open={Boolean(state?.error || state?.fields)}
        className="border-t"
      >
        <summary className="flex min-h-10 cursor-pointer items-center px-4 text-sm font-medium text-primary-ink">
          {t("replace")}
        </summary>
        <div className="border-t">
          <p className="px-4 pt-4 text-sm text-pretty">
            {keys.length > 1 ? t("replaceSeveralWarning") : t("replaceWarning")}
          </p>
          {issue}
        </div>
      </details>
    </>
  );
}

// The key itself, whole and selected, ready to copy, with the note that it is not shown again.
function NewKey({ value, onDone }: { value: string; onDone: () => void }) {
  const t = useTranslations("account.apiKeys.newKey");
  return (
    <div className="space-y-3 p-4">
      <h3 className="text-sm font-semibold">{t("heading")}</h3>
      <p role="status" className="text-sm font-medium text-pretty">
        {t("note")}
      </p>
      <Textarea
        readOnly
        value={value}
        aria-label={t("label")}
        autoFocus
        spellCheck={false}
        onFocus={(event) => event.currentTarget.select()}
        className="min-h-0 resize-none font-mono break-all"
      />
      <div className="flex flex-wrap items-center gap-3">
        <CopyButton value={value} />
        <Button type="button" onClick={onDone} className="min-h-10 px-4">
          {t("done")}
        </Button>
      </div>
    </div>
  );
}
