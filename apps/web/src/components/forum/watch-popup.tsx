"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { FormError } from "@/components/forum/form-error";
import {
  type Watch,
  WatchIcon,
  watchButtonClass,
  watchOf,
  watchText,
} from "@/components/forum/watch-button";
import { Button } from "@/components/ui/button";
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

const choice = "flex min-h-10 items-center gap-2.5 text-sm";

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

// The popover's form: a forum's choice between new threads and every new post, the email box, and
// Follow (or Save and Unfollow while the member watches). `current` is what is shown now.
export function WatchForm({
  current,
  modes,
  pending,
  error,
  send,
}: {
  current: Watch;
  modes: boolean;
  pending: boolean;
  error: string | undefined;
  send: (next: Watch) => void;
}) {
  const t = useTranslations("forum.watchButton");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        send({
          mode: data.get("mode") === "posts" ? "posts" : "threads",
          email: data.get("email") === "on",
        });
      }}
      className="space-y-2"
    >
      {modes && (
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{t("notifyFor")}</legend>
          {(["threads", "posts"] as const).map((mode) => (
            <label key={mode} className={choice}>
              <input
                type="radio"
                name="mode"
                value={mode}
                defaultChecked={(current?.mode ?? "threads") === mode}
                className="size-4 accent-primary"
              />
              {t(mode === "posts" ? "optionPosts" : "optionThreads")}
            </label>
          ))}
        </fieldset>
      )}
      <label className={choice}>
        <input
          type="checkbox"
          name="email"
          defaultChecked={current?.email ?? false}
          className="size-4 accent-primary"
        />
        {t("email")}
      </label>
      {error && <FormError>{error}</FormError>}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          type="submit"
          disabled={pending}
          focusableWhenDisabled
          className="h-10 px-3 aria-disabled:opacity-50"
        >
          {current ? t("save") : t("watch")}
        </Button>
        {current && (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            focusableWhenDisabled
            className="h-10 px-3 aria-disabled:opacity-50"
            onClick={() => send(null)}
          >
            {t("stop")}
          </Button>
        )}
      </div>
    </form>
  );
}
