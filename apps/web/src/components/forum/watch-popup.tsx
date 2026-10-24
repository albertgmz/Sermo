"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  type Watch,
  WatchIcon,
  watchButtonClass,
  watchOf,
  watchText,
} from "@/components/forum/watch-button";
import { WatchForm } from "@/components/forum/watch-form";
import type { OpenedProps } from "@/components/ui/lazy-popup";
import { usePopupFocus } from "@/components/ui/lazy-popup-focus";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { type ChangeResult, changeItem } from "@/lib/item-state";

export type WatchPopupProps = {
  // The key of the watch in the store of changes, what the server drew and what is shown.
  stateKey: string;
  drawn: string;
  shown: string;
  // The button's words.
  text: string;
  modes: boolean;
  save: (watch: Watch) => Promise<ChangeResult>;
};

// The watch button and its popover, which Base UI draws. It is loaded when the plain button of
// `WatchButton` is pressed and mounts open. The form starts from what is shown each time it opens;
// a press shows the change on the button at once and closes the popover once the backend took it,
// or keeps it open with the refusal.
export default function WatchPopup({
  stateKey,
  drawn,
  shown,
  text,
  modes,
  save,
  openedBy,
}: WatchPopupProps & OpenedProps) {
  const tFailed = useTranslations("lib.errors");
  const router = useRouter();
  const focus = usePopupFocus(openedBy);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  const current = watchOf(shown);

  function send(next: Watch) {
    setError(undefined);
    start(async () => {
      const { error: refused, signIn } = await changeItem(
        stateKey,
        drawn,
        watchText(next),
        () => save(next),
        tFailed("generic"),
      );
      if (signIn) router.push(signIn);
      else if (refused) setError(refused);
      else setOpen(false);
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(undefined);
      }}
    >
      <PopoverTrigger className={watchButtonClass}>
        <WatchIcon on={current !== null} />
        {text}
      </PopoverTrigger>
      <PopoverContent
        ref={focus.ref}
        initialFocus={focus.initialFocus}
        align="end"
        className="w-72 max-w-[calc(100vw-2rem)]"
      >
        <WatchForm
          current={current}
          modes={modes}
          pending={pending}
          error={error}
          send={send}
        />
      </PopoverContent>
    </Popover>
  );
}
