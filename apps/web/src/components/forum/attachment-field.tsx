"use client";

import {
  ImageIcon,
  ImagePlus,
  LoaderCircle,
  Maximize2,
  Paperclip,
  X,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
  createIntake,
  receiveOffers,
} from "@/components/forum/attachment-intake";
import {
  attachTag,
  insertIntoComposer,
  removeFromComposer,
} from "@/components/forum/composer-insert";
import { FormError } from "@/components/forum/form-error";
import { messageActionClass } from "@/components/forum/message-action";
import { useUploadLimit } from "@/components/forum/upload-limit";
import { megabytes, uploadLimit } from "@/lib/sermo/upload-limit";
import { cn } from "@/lib/utils";

// `type` is the content type, which says whether the file can be placed in the text as a picture.
export type AttachedFile = {
  id: number;
  name: string;
  size: number | null;
  type?: string;
};

const INSERT_BUTTON =
  "inline-flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground";

// Files for a post. Each one is sent to an attachment route as soon as it is chosen and the post
// names the stored files by id (`attachmentIds`), so no file travels with the form.
export function AttachmentField({
  nodeId,
  initial = [],
  compact = false,
  allowed = true,
  onBusy,
}: {
  // The forum the post is for. A message or a profile post has none.
  nodeId?: number;
  initial?: AttachedFile[];
  // For a one-line composer: only the paperclip, which takes its place in the composer's own row
  // (a wrapping flex row), with the chosen files on a line of their own before it.
  compact?: boolean;
  // Whether files may be added here. Without it the paperclip is gone and the files already
  // chosen stay listed, so they can be removed.
  allowed?: boolean;
  // Told whether a file is still on its way, so the form can wait for it.
  onBusy?: (busy: boolean) => void;
}) {
  const t = useTranslations("forum.attachmentField");
  const format = useFormatter();
  const limit = uploadLimit("attachment", useUploadLimit());
  const [files, setFiles] = useState<AttachedFile[]>(initial);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string>();
  const listed = useRef<HTMLInputElement>(null);
  const first = useRef(initial);

  useEffect(() => onBusy?.(busy > 0), [busy, onBusy]);

  // A form that is reset (React does it once a form's action has answered) starts over, with the
  // files it began with.
  useEffect(() => {
    const form = listed.current?.form;
    if (!form) return;
    const clear = () => {
      setFiles(first.current);
      setError(undefined);
    };
    form.addEventListener("reset", clear);
    return () => form.removeEventListener("reset", clear);
  }, []);

  // Every refusal of a batch stays, one after the other.
  function refuse(message: string) {
    setError((current) => (current ? `${current} ${message}` : message));
  }

  async function send(file: File): Promise<AttachedFile | undefined> {
    const body = new FormData();
    body.append("file", file, file.name);
    setBusy((count) => count + 1);
    try {
      const response = await fetch(
        nodeId === undefined ? "/attachments" : `/threads/${nodeId}/uploads`,
        { method: "POST", body },
      );
      const payload: {
        id?: number;
        error?: string;
        contentType?: string;
      } | null = await response.json().catch(() => null);
      if (response.ok && typeof payload?.id === "number") {
        const added = {
          id: payload.id,
          name: file.name,
          size: file.size,
          type: payload.contentType ?? file.type,
        };
        setFiles((current) => [...current, added]);
        return added;
      }
      refuse(payload?.error ?? t("failed", { name: file.name }));
    } catch {
      refuse(t("failed", { name: file.name }));
    } finally {
      setBusy((count) => count - 1);
    }
    return undefined;
  }

  // Puts the file's tag at the caret of the composer's text. `background`: it was not asked for just
  // now (a picture that finished uploading), so the focus stays where the member has it.
  function place(
    file: AttachedFile,
    size: "thumb" | "full",
    background = false,
  ) {
    insertIntoComposer(listed.current, attachTag(file.id, size), background);
  }

  // The latest functions, for the intake that is made once.
  const latest = useRef({ send, place, setError });
  latest.current = { send, place, setError };
  const [intake] = useState(() =>
    createIntake<AttachedFile>({
      send: (file) => latest.current.send(file),
      place: (file) => latest.current.place(file, "full", true),
      clearError: () => latest.current.setError(undefined),
    }),
  );

  // The editor offers the files pasted or dropped into it, while files may be added here.
  useEffect(
    () => receiveOffers(listed.current?.form, allowed, intake),
    [allowed, intake],
  );

  const trigger = (
    <label
      className={cn(
        messageActionClass,
        "cursor-pointer has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
        compact
          ? "size-10 shrink-0 px-0 md:size-10"
          : "border border-border px-3",
      )}
    >
      <Paperclip aria-hidden="true" />
      {compact ? <span className="sr-only">{t("attach")}</span> : t("attach")}
      <input
        type="file"
        multiple
        className="sr-only"
        onChange={(event) => {
          const chosen = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void intake(chosen);
        }}
      />
    </label>
  );
  const uploading = busy > 0 && (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
        compact && "basis-full",
      )}
    >
      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
      {t("uploading")}
    </span>
  );
  const chosen = (
    <>
      {/* Says that the files named below are the whole list, which an empty list is too. */}
      <input ref={listed} type="hidden" name="attachments" value="listed" />
      {files.map((file) => (
        <input
          key={file.id}
          type="hidden"
          name="attachmentIds"
          value={file.id}
        />
      ))}
      {files.length > 0 && (
        <ul
          aria-label={t("aria.files")}
          className={cn(
            "flex flex-wrap gap-2",
            // A composer's bar stays a bar: many files scroll inside it.
            compact && "max-h-28 basis-full overflow-y-auto",
          )}
        >
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
              {file.type?.startsWith("image/") ? (
                <>
                  <button
                    type="button"
                    aria-label={t("aria.insertThumbnail", { name: file.name })}
                    title={t("insertThumbnail")}
                    className={INSERT_BUTTON}
                    onClick={() => place(file, "thumb")}
                  >
                    <ImageIcon className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("aria.insertFull", { name: file.name })}
                    title={t("insertFull")}
                    className={INSERT_BUTTON}
                    onClick={() => place(file, "full")}
                  >
                    <Maximize2 className="size-4" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  aria-label={t("aria.insert", { name: file.name })}
                  title={t("insert")}
                  className={INSERT_BUTTON}
                  onClick={() => place(file, "thumb")}
                >
                  <ImagePlus className="size-4" />
                </button>
              )}
              <button
                type="button"
                aria-label={t("aria.remove", { name: file.name })}
                className={INSERT_BUTTON}
                onClick={() => {
                  // Its tags come out of the text too: nothing is left to show a file that is gone.
                  removeFromComposer(listed.current, file.id);
                  setFiles((current) =>
                    current.filter((other) => other.id !== file.id),
                  );
                }}
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <FormError className={compact ? "basis-full" : undefined}>
          {error}
        </FormError>
      )}
    </>
  );

  if (compact) {
    return (
      <div className="contents">
        {chosen}
        {uploading}
        {allowed && trigger}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {allowed && trigger}
        {limit !== null && (
          <span className="text-xs text-muted-foreground">
            {t("limit", { size: megabytes(limit) })}
          </span>
        )}
        {uploading}
      </div>
      {chosen}
    </div>
  );
}
