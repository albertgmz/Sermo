"use client";

// FramingDialog: frame a chosen picture before it is uploaded (a sheet on phones, a dialog from
// `sm`). The picture is drawn on a canvas inside a frame of the shape it will have (a circle for
// an avatar, 5:2 for a cover); dragging moves it, the slider, pinching and + / - zoom it, and the
// arrow keys move it. Confirming crops the framed area with a canvas into a new picture and hands
// it to `onConfirm`; nothing else is uploaded. The maths is in lib/framing.ts.
//
// Props
//   file       The picture the member chose, or null while the dialog is closed.
//   shape      "avatar" or "cover".
//   limit      The most a picture may have, in bytes, or null when not known; a framed picture
//              above it is not sent.
//   onConfirm  Gets the cropped picture and its file name; answers { ok: true } (the dialog closes)
//              or { error } (the dialog stays open and shows it).
//   onClose    The member cancelled or the picture was saved.
//
// The picture is decoded with createImageBitmap and only ever drawn on canvases, so it never
// becomes an image element of the page.

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SaveResult } from "@/lib/autosave";
import {
  centred,
  clampZoom,
  cropRect,
  dragBy,
  encodeFramed,
  type Framing,
  isAnimated,
  MAX_ZOOM,
  outputName,
  outputSize,
  outputType,
  type Rect,
  SHAPES,
  type Shape,
  zoomTo,
} from "@/lib/framing";
import { megabytes } from "@/lib/sermo/upload-limit";
import { cn } from "@/lib/utils";

// The preview canvas has twice the pixels it is shown with, so it stays sharp on dense screens.
const PREVIEW: Record<Shape, { width: number; height: number }> = {
  avatar: { width: 480, height: 480 },
  cover: { width: 800, height: 320 },
};

const KEY_STEP = 0.05;
const ZOOM_STEP = 0.2;

// `scale` is the size of `image` over the size of the picture the rectangle is measured in, for
// the downscaled bitmap the preview draws from.
function draw(
  context: CanvasRenderingContext2D,
  image: ImageBitmap,
  rect: Rect,
  width: number,
  height: number,
  scale = 1,
) {
  context.clearRect(0, 0, width, height);
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    rect.x * scale,
    rect.y * scale,
    rect.width * scale,
    rect.height * scale,
    0,
    0,
    width,
    height,
  );
}

// JPEG has no transparency, so a picture with see-through areas is put on white first; left alone
// those areas would come out black. White (not PNG) keeps a WebP request that falls back small.
function flattened(source: HTMLCanvasElement): HTMLCanvasElement {
  const flat = document.createElement("canvas");
  flat.width = source.width;
  flat.height = source.height;
  const context = flat.getContext("2d");
  if (!context) return source;
  context.fillStyle = "white";
  context.fillRect(0, 0, flat.width, flat.height);
  context.drawImage(source, 0, 0);
  return flat;
}

function Framer({
  file,
  shape,
  limit,
  busy,
  setBusy,
  onConfirm,
  onClose,
}: {
  file: File;
  shape: Shape;
  limit: number | null;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onConfirm: (blob: Blob, name: string) => Promise<SaveResult>;
  onClose: () => void;
}) {
  const t = useTranslations("forum.framing");
  const { aspect } = SHAPES[shape];
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  // The full picture, for the crop that is saved, and a smaller copy the preview draws from, so a
  // large photo does not make every drag frame resample millions of pixels.
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [small, setSmall] = useState<ImageBitmap | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  // A moving GIF or WebP, which framing would make still: it can be sent as it is instead.
  const [animated, setAnimated] = useState(false);
  const [framing, setFraming] = useState<Framing>({ zoom: 1, cx: 0, cy: 0 });
  const [error, setError] = useState("");

  useEffect(() => {
    const made: ImageBitmap[] = [];
    let live = true;
    (async () => {
      const full = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      if (!live) {
        full.close();
        return;
      }
      made.push(full);
      const wanted = PREVIEW[shape].width * 2;
      const reduced =
        full.width > wanted
          ? await createImageBitmap(full, {
              resizeWidth: wanted,
              resizeQuality: "high",
            })
          : full;
      if (!live) {
        if (reduced !== full) reduced.close();
        return;
      }
      if (reduced !== full) made.push(reduced);
      setFraming(centred(full));
      setSmall(reduced);
      setImage(full);
    })().catch(() => live && setUnreadable(true));
    return () => {
      live = false;
      for (const bitmap of made) bitmap.close();
    };
  }, [file, shape]);

  useEffect(() => {
    if (file.type !== "image/gif" && file.type !== "image/webp") return;
    let live = true;
    file
      .arrayBuffer()
      .then((bytes) => live && setAnimated(isAnimated(new Uint8Array(bytes))))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [file]);

  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context || !image || !small) return;
    const { width, height } = PREVIEW[shape];
    draw(
      context,
      small,
      cropRect(image, aspect, framing),
      width,
      height,
      small.width / image.width,
    );
  }, [image, small, framing, shape, aspect]);

  const viewWidth = () => canvas.current?.getBoundingClientRect().width ?? 0;
  const move = (dx: number, dy: number) =>
    image &&
    setFraming((now) => dragBy(image, aspect, now, dx, dy, viewWidth()));
  const zoom = (to: number) =>
    image && setFraming((now) => zoomTo(image, aspect, now, to));

  function onPointerDown(event: React.PointerEvent<HTMLElement>) {
    // The primary button only: a right click opens a menu and must not start a drag.
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
  }

  const onPointerEnd = (event: React.PointerEvent) =>
    pointers.current.delete(event.pointerId);

  function onPointerMove(event: React.PointerEvent) {
    const known = pointers.current.get(event.pointerId);
    if (!known || !image) return;
    const others = [...pointers.current].filter(
      ([id]) => id !== event.pointerId,
    );
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    const other = others[0]?.[1];
    if (other) {
      // Two fingers: the distance between them scales the zoom.
      const before = Math.hypot(known.x - other.x, known.y - other.y);
      const after = Math.hypot(
        event.clientX - other.x,
        event.clientY - other.y,
      );
      if (before > 0) {
        setFraming((now) =>
          zoomTo(image, aspect, now, now.zoom * (after / before)),
        );
      }
      return;
    }
    move(event.clientX - known.x, event.clientY - known.y);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const step = viewWidth() * KEY_STEP;
    const keys: Record<string, () => unknown> = {
      ArrowLeft: () => move(-step, 0),
      ArrowRight: () => move(step, 0),
      ArrowUp: () => move(0, -step),
      ArrowDown: () => move(0, step),
      "+": () => zoom(framing.zoom + ZOOM_STEP),
      "=": () => zoom(framing.zoom + ZOOM_STEP),
      "-": () => zoom(framing.zoom - ZOOM_STEP),
      _: () => zoom(framing.zoom - ZOOM_STEP),
    };
    const run = keys[event.key];
    if (!run) return;
    event.preventDefault();
    run();
  }

  async function save() {
    if (!image) return;
    setBusy(true);
    setError("");
    const rect = cropRect(image, aspect, framing);
    const size = outputSize(shape, rect);
    const target = document.createElement("canvas");
    target.width = size.width;
    target.height = size.height;
    const context = target.getContext("2d");
    if (context) {
      context.imageSmoothingQuality = "high";
      draw(context, image, rect, size.width, size.height);
    }
    const blob = context
      ? await encodeFramed(
          (type, quality) =>
            new Promise<Blob | null>((done) =>
              (type === "image/jpeg" ? flattened(target) : target).toBlob(
                done,
                type,
                quality,
              ),
            ),
          outputType(file.type),
        )
      : null;
    await send(blob, blob ? outputName(file.name, blob.type) : "");
  }

  // Hands a picture on (the framed one, or the original) and keeps the dialog open to say why not.
  async function send(blob: Blob | null, name: string) {
    if (!blob) {
      setError(t("encodeFailed"));
    } else if (limit !== null && blob.size > limit) {
      setError(t("overLimit", { size: megabytes(limit) }));
    } else {
      const result = await onConfirm(blob, name);
      if ("error" in result) setError(result.error || t("failed"));
      else onClose();
    }
    setBusy(false);
  }

  const preview = PREVIEW[shape];
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {shape === "avatar" ? t("avatarTitle") : t("coverTitle")}
        </DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>
      {unreadable ? (
        <p role="alert" className="text-sm text-destructive">
          {t("unreadable")}
        </p>
      ) : (
        <div className="space-y-4">
          {/* The frame is one focusable region: the keys and the pointer move the picture drawn in it. */}
          <div
            // biome-ignore lint/a11y/noNoninteractiveTabindex: an application region the arrow keys drive
            tabIndex={0}
            role="application"
            aria-label={shape === "avatar" ? t("avatarLabel") : t("coverLabel")}
            aria-describedby="framing-hint"
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onLostPointerCapture={onPointerEnd}
            className={cn(
              "relative mx-auto w-full cursor-grab touch-none overflow-hidden rounded-lg border bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing",
              shape === "avatar" ? "max-w-72" : "max-w-xl",
            )}
            style={{ aspectRatio: `${preview.width} / ${preview.height}` }}
          >
            <canvas
              ref={canvas}
              width={preview.width}
              height={preview.height}
              className="block size-full"
            />
            {shape === "avatar" && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_100vmax_var(--overlay)] ring-2 ring-foreground/60"
              />
            )}
            {!image && (
              <p className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                {t("reading")}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <label htmlFor="framing-zoom" className="block text-sm font-medium">
              {t("zoom")}
            </label>
            <input
              id="framing-zoom"
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={clampZoom(framing.zoom)}
              disabled={!image}
              onChange={(event) => zoom(Number(event.target.value))}
              className="block h-10 w-full accent-primary"
            />
            <p id="framing-hint" className="text-xs text-muted-foreground">
              {t("hint")}
            </p>
          </div>
        </div>
      )}
      {animated && !unreadable && (
        <p className="text-xs text-muted-foreground">{t("animatedStill")}</p>
      )}
      <output
        aria-live="polite"
        className="block text-xs font-medium text-destructive empty:hidden [overflow-wrap:anywhere]"
      >
        {error}
      </output>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          className="min-h-10 px-4"
          disabled={busy}
          onClick={onClose}
        >
          {t("cancel")}
        </Button>
        {(unreadable || animated) && (
          <Button
            type="button"
            variant={unreadable ? "default" : "outline"}
            className="min-h-10 px-4"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              void send(file, file.name);
            }}
          >
            {busy && unreadable ? t("saving") : t("useOriginal")}
          </Button>
        )}
        {!unreadable && (
          <Button
            type="button"
            className="min-h-10 px-4"
            disabled={busy || !image}
            onClick={save}
          >
            {busy ? t("saving") : t("save")}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

export function FramingDialog({
  file,
  shape,
  limit,
  onConfirm,
  onClose,
}: {
  file: File | null;
  shape: Shape;
  limit: number | null;
  onConfirm: (blob: Blob, name: string) => Promise<SaveResult>;
  onClose: () => void;
}) {
  // While a picture is being sent the dialog stays: closing would hide the outcome.
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={file !== null}
      onOpenChange={(open) => !open && !busy && onClose()}
    >
      <DialogContent
        className="top-auto bottom-0 left-0 max-h-[90dvh] max-w-full translate-x-0 translate-y-0 overflow-y-auto rounded-b-none pb-[max(1rem,env(safe-area-inset-bottom))] sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-b-xl sm:pb-4"
        showCloseButton={false}
      >
        {file && (
          <Framer
            key={`${file.name}:${file.lastModified}:${file.size}`}
            file={file}
            shape={shape}
            limit={limit}
            busy={busy}
            setBusy={setBusy}
            onConfirm={onConfirm}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
