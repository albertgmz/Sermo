"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { findRecipients } from "@/app/(main)/conversations/actions";
import { createThreadAction } from "@/app/(main)/forums/actions";
import { AttachmentField } from "@/components/forum/attachment-field";
import { Editor } from "@/components/forum/editor";
import { ThreadFields } from "@/components/forum/thread-fields";
import { useKeptForm } from "@/components/forum/use-kept-form";
import { Button, buttonVariants } from "@/components/ui/button";
import type { PrefixView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

export function NewThreadForm({
  id,
  prefixes,
  canAttach,
}: {
  id: number;
  prefixes: PrefixView[];
  canAttach: boolean;
}) {
  const t = useTranslations("forums.newThreadForm");
  const { state, pending, onSubmit } = useKeptForm(
    createThreadAction.bind(null, id),
  );
  const [uploading, setUploading] = useState(false);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <ThreadFields
        prefixes={prefixes}
        prefixId={state.prefixId}
        title={state.title}
        placeholder={t("placeholder")}
      />
      <Editor name="body" minHeight={200} findMembers={findRecipients} />
      {canAttach && <AttachmentField nodeId={id} onBusy={setUploading} />}
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Link
          href={`/forums/${id}`}
          className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4")}
        >
          {t("cancel")}
        </Link>
        <Button
          type="submit"
          disabled={pending || uploading}
          className="h-10 px-4"
        >
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}
