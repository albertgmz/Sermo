"use client";

// PictureField: the picture control of a panel form. It uploads the chosen file at once to the
// panel's upload route (`POST /admin/uploads?purpose=...`, never through a server action) and puts
// the id the backend stored it under in a hidden field the form's server action reads. The file
// input itself has no name, so the file is never submitted with the form.
//
// Props
//   purpose   The backend's file purpose: one of `frame`, `cover_preset`, `thread_cover`,
//             `node_icon`, `node_cover`, `award_image`, `shop_image`, `site_logo`, `site_icon`,
//             `site_backdrop`, `reaction_image`. The backend checks the permission, the type and the size.
//   name      Name of the hidden field that carries the new file id. Default "fileId". It is empty
//             until a file was uploaded; the action attaches the picture only when it is not.
//   id        Id of the file input, for the row's label (`FieldRow htmlFor`).
//   current   The picture now, drawn by the caller on the server (an `Art` with its LITE
//             category, or any slot), so the picture goes through the same gate as on the public
//             site. Omit it when there is none.
//   accept    The file types the chooser offers (the input's `accept`). Default "image/*"; it only
//             narrows the chooser, the backend still checks the type.
//   removable true shows a "Remove" control. Choosing it sets a second hidden field named
//             `<name>Remove` to "1" and the action then sends `fileId: null`; choosing a new
//             file instead cancels the removal. Default false.
//
// What the action reads: `formData.get(name)` (a file id as text, or "") and, when `removable`,
// `formData.get(`${name}Remove`) === "1"`. Both are checked there: the form is client input.

import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { useUploadLimit } from "@/components/forum/upload-limit";
import { Button } from "@/components/ui/button";
import { megabytes, uploadLimit } from "@/lib/sermo/upload-limit";
import { cn } from "@/lib/utils";

type State =
  | { phase: "idle" }
  | { phase: "uploading"; percent: number; file: string }
  | { phase: "done"; file: string }
  | { phase: "failed"; message: string };

export function PictureField({
  purpose,
  name = "fileId",
  id,
  current,
  removable = false,
  accept = "image/*",
}: {
  purpose: string;
  name?: string;
  id?: string;
  current?: React.ReactNode;
  removable?: boolean;
  accept?: string;
}) {
  const t = useTranslations("adminForums.pictureField");
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const limit = uploadLimit(purpose, useUploadLimit());
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<XMLHttpRequest | null>(null);
  const [state, setState] = useState<State>({ phase: "idle" });
  const [fileId, setFileId] = useState("");
  const [removed, setRemoved] = useState(false);

  function upload(file: File) {
    request.current?.abort();
    setFileId("");
    setRemoved(false);
    setState({ phase: "uploading", percent: 0, file: file.name });
    const body = new FormData();
    body.set("file", file);
    const xhr = new XMLHttpRequest();
    request.current = xhr;
    xhr.open("POST", `/admin/uploads?purpose=${encodeURIComponent(purpose)}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setState({
          phase: "uploading",
          percent: Math.round((event.loaded / event.total) * 100),
          file: file.name,
        });
      }
    };
    xhr.onload = () => {
      let answer: { id?: unknown; error?: unknown } | null = null;
      try {
        answer = JSON.parse(xhr.responseText);
      } catch {
        answer = null;
      }
      if (
        xhr.status >= 200 &&
        xhr.status < 300 &&
        typeof answer?.id === "number"
      ) {
        setFileId(String(answer.id));
        setState({ phase: "done", file: file.name });
        return;
      }
      setState({
        phase: "failed",
        message: typeof answer?.error === "string" ? answer.error : t("failed"),
      });
      if (input.current) input.current.value = "";
    };
    xhr.onerror = () => {
      setState({ phase: "failed", message: t("failed") });
      if (input.current) input.current.value = "";
    };
    xhr.send(body);
  }

  function clear() {
    request.current?.abort();
    setFileId("");
    setState({ phase: "idle" });
    if (input.current) input.current.value = "";
  }

  const uploading = state.phase === "uploading";
  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={fileId} />
      {removable && (
        <input
          type="hidden"
          name={`${name}Remove`}
          value={removed ? "1" : ""}
        />
      )}
      {current && !removed && (
        <div className="flex items-center gap-3">{current}</div>
      )}
      {removed && (
        <p className="text-xs text-muted-foreground">{t("willRemove")}</p>
      )}
      <input
        ref={input}
        id={inputId}
        type="file"
        accept={accept}
        aria-busy={uploading}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) upload(file);
          else clear();
        }}
        className={cn(
          "block w-full min-w-0 text-sm text-muted-foreground file:me-3 file:min-h-10 file:cursor-pointer file:rounded-lg file:border file:border-input file:bg-card file:px-3 file:text-sm file:font-medium file:text-foreground",
        )}
      />
      {limit !== null && (
        <p className="text-xs text-muted-foreground">
          {t("limit", { size: megabytes(limit) })}
        </p>
      )}
      <div aria-live="polite" className="text-xs [overflow-wrap:anywhere]">
        {state.phase === "uploading" && (
          <>
            <progress
              value={state.percent}
              max={100}
              aria-label={t("progress", { file: state.file })}
              className="block h-2 w-full"
            />
            <span className="text-muted-foreground">
              {t("uploading", { file: state.file, percent: state.percent })}
            </span>
          </>
        )}
        {state.phase === "done" && (
          <span className="font-medium text-success">
            {t("done", { file: state.file })}
          </span>
        )}
        {state.phase === "failed" && (
          <span className="font-medium text-destructive">{state.message}</span>
        )}
      </div>
      {removable && (current || removed) && (
        <Button
          type="button"
          variant="outline"
          className="min-h-10 px-4"
          onClick={() => {
            if (removed) {
              setRemoved(false);
              return;
            }
            clear();
            setRemoved(true);
          }}
        >
          {removed ? t("keep") : t("remove")}
        </Button>
      )}
    </div>
  );
}
