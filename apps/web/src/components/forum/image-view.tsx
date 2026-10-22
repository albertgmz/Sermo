"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import {
  $getNodeByKey,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  type NodeKey,
  stopLexicalPropagation,
} from "lexical";
import { LoaderCircle, Paperclip, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { ImageNode } from "@/components/forum/image-node";
import { uploadOf } from "@/components/forum/image-node";
import { buttonVariants } from "@/components/ui/button";
import { blocks, parseLiteCookieHeader } from "@/lib/lite-preferences";
import { cn } from "@/lib/utils";

// The size presets, for touch and for the keyboard: a width in pixels, or the column's (none).
const PRESETS = [
  ["small", "200px"],
  ["medium", "400px"],
  ["full", null],
] as const;
const MIN = 48;
const STEP = 10;
// Events from the picture's own controls that the editor must not take as typing in its text: the
// alt text field gets its keys and the buttons their presses (Backspace there deletes a character,
// not the picture).
const OWN_EVENTS = [
  "keydown",
  "keyup",
  "beforeinput",
  "input",
  "paste",
  "cut",
  "copy",
  "compositionstart",
  "compositionend",
  "pointerdown",
  "mousedown",
  "click",
  "dragstart",
];

// The picture of an `ImageNode`: the file itself (or, while it uploads, the member's copy of it,
// dimmed, with a spinner), selectable with a click or the arrow keys, removed with Delete. Selected,
// it shows a corner handle that resizes it (by dragging, or with the arrow keys), size presets and
// a field for its alt text.
export function ImageView({
  nodeKey,
  id,
  upload,
  full,
  width,
  alt,
}: {
  nodeKey: NodeKey;
  id: number | null;
  upload: string | null;
  full: boolean;
  width: string | null;
  alt: string;
}) {
  const t = useTranslations("editor.editor.image");
  const [editor] = useLexicalComposerContext();
  const [selected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);
  const [broken, setBroken] = useState(false);
  // The width while a drag is on, before it is written.
  const [dragged, setDragged] = useState<number | null>(null);
  const picture = useRef<HTMLImageElement>(null);
  const controls = useRef<HTMLFieldSetElement>(null);
  const handle = useRef<HTMLSpanElement>(null);

  const state = uploadOf(upload);
  const pending = state !== undefined && !state.id && !state.failed;
  // Data saver: a stored picture is not fetched (one still uploading is the member's own file).
  const [hidden] = useState(
    () =>
      typeof document !== "undefined" &&
      blocks(parseLiteCookieHeader(document.cookie), "postImages"),
  );
  const src =
    state?.preview ??
    (id !== null && !hidden ? `/api/v1/files/${id}` : undefined);

  useEffect(
    () =>
      editor.registerCommand(
        CLICK_COMMAND,
        (event) => {
          if (event.target !== picture.current) return false;
          if (!event.shiftKey) clearSelection();
          setSelected(true);
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor, clearSelection, setSelected],
  );

  // Native listeners: the editor listens on its root, under which this is drawn, before React does.
  useEffect(() => {
    const box = controls.current;
    const corner = handle.current;
    const targets = [box, corner].filter((el) => el !== null);
    for (const target of targets)
      for (const name of OWN_EVENTS)
        target.addEventListener(name, stopLexicalPropagation);
    return () => {
      for (const target of targets)
        for (const name of OWN_EVENTS)
          target.removeEventListener(name, stopLexicalPropagation);
    };
  });

  const update = (change: (node: ImageNode) => void) =>
    editor.update(() => {
      const node = $getNodeByKey<ImageNode>(nodeKey);
      if (node) change(node);
    });
  // The widest the picture can be: the text's column.
  const widest = () => {
    const root = editor.getRootElement();
    if (!root) return Number.POSITIVE_INFINITY;
    const style = getComputedStyle(root);
    return (
      root.clientWidth -
      Number.parseFloat(style.paddingLeft) -
      Number.parseFloat(style.paddingRight)
    );
  };
  const shownWidth = () =>
    dragged ?? Math.round(picture.current?.getBoundingClientRect().width ?? 0);
  // A width as wide as the column is no width: the picture fills it, as "full" does.
  const resize = (to: number) => {
    const max = widest();
    const next = Math.max(MIN, Math.min(Math.round(to), max));
    update((node) => node.setWidth(next >= max ? null : `${next}px`));
  };

  const onPointerDown = (event: React.PointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    const start = event.clientX;
    const from = shownWidth();
    const max = widest();
    const corner = event.currentTarget;
    corner.setPointerCapture(event.pointerId);
    const move = (moved: PointerEvent) =>
      setDragged(Math.max(MIN, Math.min(from + moved.clientX - start, max)));
    const end = (ended: PointerEvent) => {
      corner.removeEventListener("pointermove", move);
      corner.removeEventListener("pointerup", end);
      corner.removeEventListener("pointercancel", end);
      setDragged(null);
      if (ended.type === "pointerup") resize(from + ended.clientX - start);
    };
    corner.addEventListener("pointermove", move);
    corner.addEventListener("pointerup", end);
    corner.addEventListener("pointercancel", end);
  };

  const onHandleKey = (event: React.KeyboardEvent<HTMLSpanElement>) => {
    const step = event.shiftKey ? STEP * 5 : STEP;
    const now = shownWidth();
    const to: Record<string, number> = {
      ArrowRight: now + step,
      ArrowUp: now + step,
      ArrowLeft: now - step,
      ArrowDown: now - step,
      Home: MIN,
      End: Number.POSITIVE_INFINITY,
    };
    if (!(event.key in to)) return;
    event.preventDefault();
    resize(to[event.key]);
  };

  const remove = () => update((node) => node.remove());
  const style = {
    width: dragged !== null ? `${dragged}px` : (width ?? undefined),
  };
  const label = alt || t("picture");

  if (state?.failed || broken || (src === undefined && !pending)) {
    // The tag stays in the text: a file that is not a picture, one the member cannot see, or a
    // picture hidden by the data saver shows as a labelled box; a refused upload says so.
    return (
      <span
        className={cn(
          "inline-flex min-h-10 max-w-full items-center gap-2 rounded-md border bg-muted/40 px-3 align-middle text-sm",
          state?.failed && "border-destructive/50 text-destructive",
          selected && "ring-2 ring-ring",
        )}
      >
        <Paperclip aria-hidden="true" className="size-4 shrink-0" />
        <span className="truncate">
          {state?.failed
            ? t("failed")
            : hidden
              ? t("hidden")
              : t("attachment", { id: id ?? 0 })}
        </span>
        <fieldset ref={controls} className="contents">
          <button
            type="button"
            aria-label={t("remove")}
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
            onClick={remove}
          >
            <X />
          </button>
        </fieldset>
      </span>
    );
  }

  return (
    <>
      {src ? (
        // biome-ignore lint/performance/noImgElement: the member's own picture in the editor, not a page's
        <img
          ref={picture}
          src={src}
          alt={label}
          draggable={false}
          onError={() => setBroken(true)}
          style={style}
          className={cn(
            "block h-auto max-w-full rounded-md",
            !full && !width && dragged === null && "max-w-40",
            pending && "opacity-60",
            selected && "ring-2 ring-ring ring-offset-2 ring-offset-card",
          )}
        />
      ) : (
        <span className="block h-24 w-40 animate-pulse rounded-md bg-muted" />
      )}
      {pending && (
        <span
          role="status"
          className="absolute inset-0 flex items-center justify-center"
        >
          <LoaderCircle
            aria-hidden="true"
            className="size-8 animate-spin rounded-full bg-card/80 p-1 text-foreground"
          />
          <span className="sr-only">{t("uploading")}</span>
        </span>
      )}
      {selected && !pending && (
        <>
          <span
            ref={handle}
            role="slider"
            tabIndex={0}
            aria-label={t("resize")}
            aria-valuemin={MIN}
            aria-valuenow={shownWidth() || undefined}
            aria-valuetext={t("width", { width: shownWidth() })}
            onPointerDown={onPointerDown}
            onKeyDown={onHandleKey}
            className="absolute -right-2 -bottom-2 size-6 cursor-nwse-resize touch-none rounded-sm border-2 border-card bg-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50 pointer-fine:size-3.5"
          />
          <fieldset
            ref={controls}
            aria-label={t("options")}
            className="absolute top-full left-0 z-10 mt-2 flex w-max max-w-[min(20rem,80vw)] flex-wrap items-center gap-1 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {PRESETS.map(([name, preset]) => (
              <button
                key={name}
                type="button"
                aria-pressed={full && width === preset}
                className={buttonVariants({ variant: "ghost", size: "sm" })}
                onClick={() => {
                  // No larger than the picture itself, which "full" is.
                  const natural = picture.current?.naturalWidth ?? 0;
                  const capped =
                    preset && natural && Number.parseInt(preset, 10) >= natural
                      ? null
                      : preset;
                  update((node) => node.setWidth(capped));
                }}
              >
                {t(name)}
              </button>
            ))}
            <input
              type="text"
              defaultValue={alt}
              maxLength={200}
              aria-label={t("alt")}
              placeholder={t("alt")}
              onChange={(event) => {
                const text = event.currentTarget.value;
                update((node) => node.setAlt(text));
              }}
              className="h-7 min-w-0 flex-1 basis-32 rounded-md border bg-background px-2 text-base outline-none focus-visible:border-ring md:text-sm"
            />
            <button
              type="button"
              aria-label={t("remove")}
              className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
              onClick={remove}
            >
              <X />
            </button>
          </fieldset>
        </>
      )}
    </>
  );
}
