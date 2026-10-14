"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { SaveStatus, useAutosave } from "@/components/forum/autosave";
import { FramingDialog } from "@/components/forum/framing-dialog";
import { SettingsRow } from "@/components/forum/settings";
import { useUploadLimit } from "@/components/forum/upload-limit";
import { Button } from "@/components/ui/button";
import type { SaveResult } from "@/lib/autosave";
import { megabytes, uploadLimit } from "@/lib/sermo/upload-limit";
import { type PictureKind, uploadPicture } from "@/lib/upload-picture";

// The avatar or the cover as a settings row. Choosing a file opens the framing dialog; the framed
// picture is uploaded when it is confirmed. Removing asks first, because the backend deletes the
// file and there is nothing to put back.
export function PictureRow({
  kind,
  title,
  description,
  current,
  hasPicture,
  note,
  remove,
}: {
  kind: PictureKind;
  title: string;
  description: string;
  // The picture now, drawn by the page on the server through its LITE gate.
  current: React.ReactNode;
  hasPicture: boolean;
  note?: string;
  remove: () => Promise<SaveResult>;
}) {
  const t = useTranslations("account.pictures");
  const router = useRouter();
  const pathname = usePathname();
  const limit = uploadLimit(kind, useUploadLimit());
  const input = useRef<HTMLInputElement>(null);
  const choose = useRef<HTMLButtonElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [asking, setAsking] = useState(false);
  const { state, autosave } = useAutosave({});
  const [refused, setRefused] = useState("");

  // The confirmation takes focus when it opens, so a keyboard or screen reader user lands in it.
  useEffect(() => {
    if (asking) keep.current?.focus();
  }, [asking]);

  async function send(blob: Blob, name: string): Promise<SaveResult> {
    const result = await autosave.perform(async () => {
      const answer = await uploadPicture(kind, blob, name);
      if (answer.ok) return { ok: true };
      if (answer.signIn)
        window.location.assign(`/login?next=${encodeURIComponent(pathname)}`);
      return { error: answer.error };
    });
    if ("ok" in result) router.refresh();
    return result;
  }

  async function removeIt() {
    setAsking(false);
    // The Remove button goes with the picture, so focus stays on the row at the one that remains.
    choose.current?.focus();
    const result = await autosave.perform(remove);
    if ("ok" in result) router.refresh();
  }

  return (
    <SettingsRow
      id={kind}
      title={title}
      description={
        <>
          {description}
          {limit !== null && ` ${t("limit", { size: megabytes(limit) })}`}
        </>
      }
      status={<SaveStatus state={state} />}
    >
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 shrink-0">{current}</div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            aria-label={t(`aria.${kind}`)}
            onChange={(event) => {
              const chosen = event.target.files?.[0] ?? null;
              event.target.value = "";
              if (!chosen) return;
              if (!chosen.type.startsWith("image/")) {
                setRefused(t("notImage"));
                return;
              }
              setRefused("");
              setFile(chosen);
            }}
          />
          <Button
            ref={choose}
            type="button"
            variant="outline"
            className="min-h-10 px-4"
            onClick={() => input.current?.click()}
          >
            {hasPicture ? t("replace") : t("choose")}
          </Button>
          {hasPicture && (
            <Button
              ref={removeButton}
              type="button"
              variant="outline"
              className="min-h-10 px-4"
              aria-expanded={asking}
              onClick={() => setAsking(true)}
            >
              {t("remove")}
            </Button>
          )}
        </div>
      </div>
      {asking && (
        <div role="alert" className="space-y-2 rounded-lg border p-3">
          <p className="text-sm">
            {kind === "avatar"
              ? t("removeAvatarConfirm")
              : t("removeCoverConfirm")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              className="min-h-10 px-4"
              onClick={removeIt}
            >
              {t("removeYes")}
            </Button>
            <Button
              ref={keep}
              type="button"
              variant="outline"
              className="min-h-10 px-4"
              onClick={() => {
                setAsking(false);
                removeButton.current?.focus();
              }}
            >
              {t("removeNo")}
            </Button>
          </div>
        </div>
      )}
      {refused && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {refused}
        </p>
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <FramingDialog
        file={file}
        shape={kind}
        limit={limit}
        onConfirm={send}
        onClose={() => setFile(null)}
      />
    </SettingsRow>
  );
}
