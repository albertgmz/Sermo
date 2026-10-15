"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ChevronLeft, ChevronRight, MapPin, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadPicture } from "@/app/[locale]/(main)/_feed/media-actions";
import { replyFromFeed } from "@/app/[locale]/(main)/actions";
import { commentOnWallPost } from "@/app/[locale]/(main)/members/actions";
import { LineComposer } from "@/components/forum/line-composer";
import { PictureImage } from "@/components/forum/picture-image";
import { arrowStep, swipeStep } from "@/components/forum/picture-input";
import {
  formatRef,
  neighbours,
  type PictureRef,
} from "@/components/forum/picture-ref";
import type {
  PictureDetails,
  PictureEntry,
  PictureResult,
} from "@/components/forum/picture-types";
import { ReactionsView } from "@/components/forum/reactions-view";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

// How long the viewer waits after a step before it asks for the details of the new picture, so a
// run of arrow presses asks for the one it stops on.
const STEP_MS = 250;
type Loaded = { key: string; result: PictureResult | "loading" };

// The details of one picture, from the server. They are asked for here, when the viewer shows the
// picture, and not for the whole list.
function useDetails(ref: PictureRef) {
  const key = formatRef(ref);
  const [loaded, setLoaded] = useState<Loaded>({ key, result: "loading" });
  const [attempt, setAttempt] = useState(0);
  const stepped = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for the whole reference
  useEffect(() => {
    let current = true;
    const wait = stepped.current ? STEP_MS : 0;
    stepped.current = true;
    const timer = setTimeout(() => {
      loadPicture(ref.kind, ref.contentId, ref.fileId).then(
        (result) => current && setLoaded({ key, result }),
        () => current && setLoaded({ key, result: { status: "failed" } }),
      );
    }, wait);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [key, attempt]);
  return {
    result: loaded.key === key ? loaded.result : ("loading" as const),
    retry: () => {
      setLoaded({ key, result: "loading" });
      setAttempt((count) => count + 1);
    },
  };
}

const EDITABLE = "input, textarea, select, [contenteditable]";

// The viewer over the list: one picture large, the one either side a key press or a swipe away,
// and beside it who posted it, where, the reactions and a reply. Esc and the close button leave it
// (`onClose` takes the address back); the picture is part of the address, so Back does too.
export default function PictureLightbox({
  current,
  entries,
  onChange,
  onClose,
}: {
  current: PictureRef;
  entries: PictureEntry[];
  onChange: (ref: PictureRef) => void;
  onClose: () => void;
}) {
  const t = useTranslations("home.pictureViewer");
  const { index, previous, next } = neighbours(entries, current);
  const entry = index >= 0 ? entries[index] : undefined;
  const { result, retry } = useDetails(current);
  const details =
    typeof result === "object" && result.status === "ready"
      ? result.details
      : undefined;
  const picture = entry ?? details?.picture;
  const finger = useRef<{ x: number; y: number } | null>(null);

  const step = (to: PictureEntry | null) => {
    if (to) onChange(to.ref);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          className="fixed inset-0 z-50 flex flex-col bg-background text-foreground outline-none md:flex-row"
          onKeyDown={(event) => {
            const to = arrowStep(
              event.key,
              event.metaKey || event.ctrlKey || event.altKey,
              (event.target as HTMLElement).closest(EDITABLE) !== null,
            );
            if (to) step(to === "next" ? next : previous);
          }}
        >
          <DialogTitle className="sr-only">{t("title")}</DialogTitle>
          <div
            className="relative flex h-[55dvh] shrink-0 items-center justify-center overflow-hidden bg-muted md:h-auto md:min-w-0 md:flex-1"
            style={{ touchAction: "pan-y" }}
            onPointerDown={(event) => {
              if (event.pointerType === "mouse") return;
              finger.current = { x: event.clientX, y: event.clientY };
            }}
            onPointerUp={(event) => {
              const from = finger.current;
              finger.current = null;
              if (!from) return;
              const to = swipeStep(
                event.clientX - from.x,
                event.clientY - from.y,
              );
              if (to) step(to === "next" ? next : previous);
            }}
            onPointerCancel={() => {
              finger.current = null;
            }}
          >
            {picture ? (
              <PictureImage
                url={picture.url}
                width={picture.width}
                height={picture.height}
                alt={entry?.label ?? t("picture")}
                blocked={t("blocked")}
                className="size-full"
              />
            ) : (
              <Skeleton className="size-full rounded-none" />
            )}
            {previous && (
              <Button
                type="button"
                variant="secondary"
                aria-label={t("previous")}
                className="absolute top-1/2 left-2 size-10 -translate-y-1/2 rounded-full"
                onClick={() => step(previous)}
              >
                <ChevronLeft />
              </Button>
            )}
            {next && (
              <Button
                type="button"
                variant="secondary"
                aria-label={t("next")}
                className="absolute top-1/2 right-2 size-10 -translate-y-1/2 rounded-full"
                onClick={() => step(next)}
              >
                <ChevronRight />
              </Button>
            )}
            <DialogPrimitive.Close
              render={
                <Button
                  type="button"
                  variant="secondary"
                  className="absolute top-2 right-2 size-10 rounded-full"
                />
              }
            >
              <X />
              <span className="sr-only">{t("close")}</span>
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto md:w-96 md:flex-none md:border-l">
            <Panel
              pictureKey={formatRef(current)}
              result={result}
              onRetry={retry}
            />
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}

// What stands beside the picture: the details as they load, or why there are none.
export function Panel({
  pictureKey,
  result,
  onRetry,
}: {
  pictureKey: string;
  result: PictureResult | "loading";
  onRetry: () => void;
}) {
  const t = useTranslations("home.pictureViewer");
  if (result === "loading")
    return (
      <div className="space-y-3 p-4" role="status">
        <span className="sr-only">{t("loading")}</span>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  if (result.status === "gone")
    return <p className="p-4 text-sm text-muted-foreground">{t("gone")}</p>;
  if (result.status === "failed")
    return (
      <div className="space-y-3 p-4">
        <p role="alert" className="text-sm text-muted-foreground">
          {t("failed")}
        </p>
        <Button
          type="button"
          variant="outline"
          className="h-10"
          onClick={onRetry}
        >
          {t("retry")}
        </Button>
      </div>
    );
  return <Details key={pictureKey} details={result.details} />;
}

function Details({ details }: { details: PictureDetails }) {
  const t = useTranslations("home.pictureViewer");
  const format = useFormatter();
  const path = usePathname();
  const search = useSearchParams().toString();
  const here = search ? `${path}?${search}` : path;
  const { author, where, reply, viewerId } = details;
  // The reaction button is told how old its markup is by its props object: it is built again only
  // when the server sends new details (see `lib/item-state`).
  const reactions = useMemo(
    () => (
      <ReactionsView data={details.reactions} viewerId={details.viewerId} />
    ),
    [details],
  );
  const action = useMemo(
    () =>
      reply?.kind === "post"
        ? replyFromFeed.bind(null, reply.threadId)
        : reply?.kind === "wall"
          ? commentOnWallPost.bind(null, reply.profilePostId, undefined)
          : undefined,
    [reply],
  );
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <Link
          href={`/members/${author.id}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {author.username}
        </Link>
        <time
          dateTime={details.createdAt}
          className="text-xs text-muted-foreground"
        >
          {format.dateTime(new Date(details.createdAt), {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </time>
      </div>
      <Link
        href={where.href}
        className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-primary-ink underline-offset-4 hover:underline"
      >
        <MapPin aria-hidden="true" className="size-4 shrink-0" />
        <span className="[overflow-wrap:anywhere]">
          {where.label === null
            ? t("onWall")
            : t("inThread", { title: where.label })}
        </span>
      </Link>
      <div className="-mx-2 flex">{reactions}</div>
      {action ? (
        <LineComposer
          action={action}
          placeholder={t(
            reply?.kind === "wall" ? "commentPlaceholder" : "replyPlaceholder",
          )}
          submitLabel={t(
            reply?.kind === "wall" ? "commentSubmit" : "replySubmit",
          )}
        />
      ) : viewerId === null ? (
        <Link
          href={`/login?next=${encodeURIComponent(here)}`}
          className="inline-flex min-h-10 items-center text-sm font-medium text-primary-ink underline-offset-4 hover:underline"
        >
          {t("signIn")}
        </Link>
      ) : null}
    </div>
  );
}
