"use client";

import { useTranslations } from "next-intl";
import { FormError } from "@/components/forum/form-error";
import type { Watch } from "@/components/forum/watch-button";
import { Button } from "@/components/ui/button";

const choice = "flex min-h-10 items-center gap-2.5 text-sm";

// The popover's form: a forum's choice between new threads and every new post, the email box, and
// Follow (or Save and Unfollow while the member watches). `current` is what is shown now. In the
// popover a press is sent in place (`send`); without scripts the form is posted (`post`), Unfollow
// as a submit named `stop`.
export function WatchForm({
  current,
  modes,
  pending = false,
  error,
  send,
  post,
}: {
  current: Watch;
  modes: boolean;
  pending?: boolean;
  error?: string;
  send?: (next: Watch) => void;
  post?: (formData: FormData) => Promise<void>;
}) {
  const t = useTranslations("forum.watchButton");
  return (
    <form
      action={post}
      onSubmit={
        send &&
        ((event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          send({
            mode: data.get("mode") === "posts" ? "posts" : "threads",
            email: data.get("email") === "on",
          });
        })
      }
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
            type={send ? "button" : "submit"}
            name={send ? undefined : "stop"}
            value={send ? undefined : "1"}
            variant="outline"
            disabled={pending}
            focusableWhenDisabled
            className="h-10 px-3 aria-disabled:opacity-50"
            onClick={send && (() => send(null))}
          >
            {t("stop")}
          </Button>
        )}
      </div>
    </form>
  );
}
