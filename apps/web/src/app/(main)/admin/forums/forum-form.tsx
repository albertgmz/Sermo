"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { previewForum } from "@/app/(main)/admin/actions";
import { FormFooter } from "@/app/(main)/admin/form-footer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ForumForm({
  id,
  title,
  description,
}: {
  id: number;
  title: string;
  description: string;
}) {
  const t = useTranslations("admin.forumForm");
  const [state, action, pending] = useActionState(
    previewForum.bind(null, id),
    null,
  );
  const [name, setName] = useState(title);
  const [summary, setSummary] = useState(description);
  const [identifier, setIdentifier] = useState("");

  return (
    <form action={action} aria-busy={pending} className="space-y-5 p-4">
      <fieldset
        disabled={pending}
        className="min-w-0 space-y-5 disabled:opacity-60"
      >
        <div className="space-y-2">
          <Label htmlFor="forum-title">{t("nameLabel")}</Label>
          <Input
            id="forum-title"
            name="title"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={2}
            maxLength={80}
            aria-invalid={state?.field === "title"}
            aria-describedby={
              state?.field === "title" ? "form-error" : undefined
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="forum-description">{t("descriptionLabel")}</Label>
          <Textarea
            id="forum-description"
            name="description"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            required
            maxLength={300}
            rows={3}
            aria-invalid={state?.field === "description"}
            aria-describedby={
              state?.field === "description" ? "form-error" : undefined
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="forum-identifier">{t("identifierLabel")}</Label>
          <Input
            id="forum-identifier"
            name="identifier"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder={t("identifierPlaceholder", { id })}
            maxLength={64}
            pattern="[a-z][a-z0-9]*(?:-[a-z0-9]+)*"
            title={t("identifierTitle")}
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={state?.field === "identifier"}
            aria-describedby={`identifier-help${state?.field === "identifier" ? " form-error" : ""}`}
          />
          <p id="identifier-help" className="text-xs text-muted-foreground">
            {t("identifierHelp", { id })}
          </p>
          <div className="rounded-md border bg-muted/50 p-3">
            <p className="text-xs font-medium text-muted-foreground">
              {t("previewLabel")}
            </p>
            <output
              htmlFor="forum-identifier"
              className="mt-1 block break-all font-mono text-sm"
            >
              /forums/
              {identifier.trim() ? encodeURIComponent(identifier.trim()) : id}
            </output>
          </div>
        </div>
      </fieldset>
      <FormFooter state={state} pending={pending} />
    </form>
  );
}
