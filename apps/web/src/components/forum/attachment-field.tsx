"use client";

import { LoaderCircle, Paperclip, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { messageActionClass } from "@/components/forum/message-action";
import { cn } from "@/lib/utils";

export type AttachedFile = { id: number; name: string; size: number | null };

// Files for a post. Each one is sent to the forum's attachment route as soon as it is chosen and
// the post names the stored files by id (`attachmentIds`), so no file travels with the form.
export function AttachmentField({
  nodeId,
  initial = [],
}: {
  nodeId: number;
  initial?: AttachedFile[];
}) {
  const t = useTranslations("forum.attachmentField");
  const format = useFormatter();
  const [files, setFiles] = useState<AttachedFile[]>(initial);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string>();

  async function send(file: File) {
    const body = new FormData();
    body.append("file", file, file.name);
    setBusy((count) => count + 1);
    try {
      const response = await fetch(`/threads/${nodeId}/uploads`, {
        method: "POST",
        body,
      });
      const payload: { id?: number; error?: string } | null = await response
        .json()
        .catch(() => null);
      if (response.ok && typeof payload?.id === "number") {
        const id = payload.id;
        setFiles((current) => [
          ...current,
          { id, name: file.name, size: file.size },
        ]);
      } else {
        setError(payload?.error ?? t("failed", { name: file.name }));
      }
    } catch {
      setError(t("failed", { name: file.name }));
    } finally {
      setBusy((count) => count - 1);
    }
  }

  async function choose(chosen: File[]) {
    setError(undefined);
    for (const file of chosen) await send(file);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label
          className={cn(
            messageActionClass,
            "cursor-pointer border border-border px-3 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
          )}
        >
          <Paperclip aria-hidden="true" />
          {t("attach")}
          <input
            type="file"
            multiple
            className="sr-only"
            onChange={(event) => {
              const chosen = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              void choose(chosen);
            }}
          />
        </label>
        {busy > 0 && (
          <span
            role="status"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <LoaderCircle
              aria-hidden="true"
              className="size-3.5 animate-spin"
            />
            {t("uploading")}
          </span>
        )}
      </div>
      {files.map((file) => (
        <input
          key={file.id}
          type="hidden"
          name="attachmentIds"
          value={file.id}
        />
      ))}
      {files.length > 0 && (
        <ul aria-label={t("aria.files")} className="flex flex-wrap gap-2">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex min-h-10 max-w-full items-center gap-1 rounded-md border bg-muted/40 pl-3 text-sm"
            >
              <span className="truncate">{file.name}</span>
              {file.size !== null && (
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {format.number(file.size / 1024, {
                    style: "unit",
                    unit: "kilobyte",
                    maximumFractionDigits: 0,
                  })}
                </span>
              )}
              <button
                type="button"
                aria-label={t("aria.remove", { name: file.name })}
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                onClick={() =>
                  setFiles((current) =>
                    current.filter((other) => other.id !== file.id),
                  )
                }
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
