"use client";

import { Bell, BellRing } from "lucide-react";
import { useTranslations } from "next-intl";
import { WatchForm } from "@/components/forum/watch-form";
import type { WatchPopupProps } from "@/components/forum/watch-popup";
import { buttonVariants } from "@/components/ui/button";
import { LazyPopup } from "@/components/ui/lazy-popup";
import { type ChangeResult, useItemState } from "@/lib/item-state";
import { cn } from "@/lib/utils";

export type WatchMode = "threads" | "posts";
export type Watch = { mode: WatchMode; email: boolean } | null;

// The store of changes (`lib/item-state`) compares what the server drew by value: the watch is kept
// there as text ("" when not watching).
export const watchText = (watch: Watch) =>
  watch ? `${watch.mode}:${watch.email ? 1 : 0}` : "";

export function watchOf(text: string): Watch {
  if (text === "") return null;
  const [mode, email] = text.split(":");
  return { mode: mode === "posts" ? "posts" : "threads", email: email === "1" };
}

// Without scripts the popover cannot open: its button steps aside for the disclosure below.
export const watchButtonClass = cn(
  buttonVariants({ variant: "outline" }),
  "h-10 px-3 unscripted:hidden",
);

// The popover's code (Base UI, its form) is fetched when the button is first reached for.
const loadPopup = () => import("@/components/forum/watch-popup");

// "Follow" of a forum or a thread, as XenForo's: one button that opens a small popover with what to
// be told about (a forum's new threads or every new post) and whether by email, saved in place. The
// button reads "Following" while the member watches; its popover then changes the choice or stops
// watching. What it shows comes from the store of changes, so it shows at once and is put back
// when the backend refuses.
//
// Props
//   item      Which forum or thread, as `forum:4` or `thread:7`.
//   watching  What the server drew: null when the member does not watch it.
//   label     The button's words when the member does not watch it ("Follow forum").
//   modes     The popover offers new threads or every new post (a forum).
//   save      The state wanted, null to stop watching (a server action).
//   post      The popover's form posted by a browser that runs no scripts (a server action that
//             shows the page again); its disclosure shows only there.
export function WatchButton(props: {
  item: string;
  watching: Watch;
  label: string;
  modes?: boolean;
  save: (watch: Watch) => Promise<ChangeResult>;
  post: (formData: FormData) => Promise<void>;
}) {
  const { item, watching, label, modes = false, save, post } = props;
  const t = useTranslations("forum.watchButton");
  const stateKey = `watch:${item}`;
  const drawn = watchText(watching);
  const shown = useItemState(stateKey, drawn, props);
  const text = shown === "" ? label : t("watching");
  const popup: WatchPopupProps = {
    stateKey,
    drawn,
    shown,
    text,
    modes,
    save,
  };
  return (
    <>
      <LazyPopup
        load={loadPopup}
        popup={popup}
        trigger={(lazy) => (
          <button
            type="button"
            data-slot="popover-trigger"
            aria-haspopup="dialog"
            aria-expanded="false"
            className={watchButtonClass}
            {...lazy}
          >
            <WatchIcon on={shown !== ""} />
            {text}
          </button>
        )}
      />
      <details className="relative hidden unscripted:block">
        <summary
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-10 cursor-pointer list-none px-3 [&::-webkit-details-marker]:hidden",
          )}
        >
          <WatchIcon on={watching !== null} />
          {watching ? t("watching") : label}
        </summary>
        <div className="absolute top-full right-0 z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-2.5 text-popover-foreground shadow-md">
          <WatchForm current={watching} modes={modes} post={post} />
        </div>
      </details>
    </>
  );
}

export function WatchIcon({ on }: { on: boolean }) {
  return on ? <BellRing aria-hidden="true" /> : <Bell aria-hidden="true" />;
}
