"use client";

// The merge of a thread into another one, in two steps because it cannot be undone: the moderator
// names the target, the server reads it back (title and forum), and only then does a second button
// do the merge. Going back keeps what was typed.

import { useTranslations } from "next-intl";
import { startTransition, useActionState, useState } from "react";
import { ActionForm } from "@/components/forum/action-form";
import { PendingButton } from "@/components/forum/pending-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MergePreview } from "../actions";

export function MergeControl({
  preview,
  merge,
}: {
  preview: (
    previous: MergePreview,
    formData: FormData,
  ) => Promise<MergePreview>;
  merge: React.ComponentProps<typeof ActionForm>["action"];
}) {
  const t = useTranslations("threads.moderation");
  const [state, dispatch] = useActionState(preview, {});
  const [typed, setTyped] = useState("");
  // The answer the moderator went back from: it is not shown again, only a newer one is.
  const [dismissed, setDismissed] = useState<MergePreview | null>(null);
  const target =
    state !== dismissed && state.submitted === typed ? state.target : undefined;
  if (target) {
    return (
      <ActionForm
        action={merge}
        variant="destructive"
        submit={t("mergeConfirm")}
        aside={
          <Button
            type="button"
            variant="ghost"
            className="h-10 px-3"
            onClick={() => setDismissed(state)}
          >
            {t("mergeBack")}
          </Button>
        }
      >
        <input type="hidden" name="target" value={target.id} />
        <p className="text-sm font-medium text-pretty [overflow-wrap:anywhere]">
          {t("mergeQuestion", { title: target.title, forum: target.forum })}
        </p>
        <p className="text-sm text-muted-foreground text-pretty">
          {t("mergeWarning")}
        </p>
      </ActionForm>
    );
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => dispatch(data));
      }}
      className="space-y-2"
    >
      <Label htmlFor="merge-target" className="text-muted-foreground">
        {t("mergeLabel")}
      </Label>
      <Input
        id="merge-target"
        name="target"
        required
        autoComplete="off"
        placeholder={t("mergePlaceholder")}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
      />
      {state.error && state.submitted === typed && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <PendingButton variant="outline" className="h-10 px-3">
        {t("mergeReview")}
      </PendingButton>
    </form>
  );
}
