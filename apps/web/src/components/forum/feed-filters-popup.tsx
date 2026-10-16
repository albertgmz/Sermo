"use client";

import { FEED_THREAD_TYPES } from "@sermo/core/contracts";
import { Eye, EyeOff, SlidersHorizontal, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteFeedFilter,
  type FilterOptions,
  feedFilterOptions,
  hideFeedForum,
  saveFeedFilter,
} from "@/app/[locale]/(main)/_feed/filter-actions";
import { FILTERS_BUTTON } from "@/components/forum/feed-filters-button";
import { ForumChecks } from "@/components/forum/forum-checks";
import { selectClass } from "@/components/staff/rows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OpenedProps } from "@/components/ui/lazy-popup";
import { usePopupFocus } from "@/components/ui/lazy-popup-focus";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  type FeedFilterValue,
  feedHref,
  filterFromParams,
  withoutExcluded,
} from "@/lib/feed-filters";
import type { HomeTab } from "@/lib/home-tabs";

export type FeedFiltersPopupProps = {
  // The feed tab that is open, and the filter on it now.
  tab: HomeTab;
  filter: FeedFilterValue;
  label: string;
};

type Loaded =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; options: FilterOptions };

// The fields of the form as a filter, and the tab it asks for: "only people I follow" is the
// Following tab, which takes the same fields.
export function readForm(form: FormData, tab: HomeTab) {
  const text = (name: string) => String(form.get(name) ?? "");
  const filter = filterFromParams({
    forums: form.getAll("forums").map(String).join(","),
    prefix: text("prefix"),
    type: text("type"),
    tag: text("tag").replace(/^#/, ""),
    watched: form.get("watched") === null ? "" : "1",
    unread: form.get("unread") === null ? "" : "1",
  });
  const target: HomeTab =
    form.get("followed") !== null
      ? "following"
      : tab === "following"
        ? "latest"
        : tab;
  return { filter, target };
}

// The sheet of the feed's filters and the button that opens it. It is loaded when the plain button
// of `FeedFiltersButton` is pressed and mounts open; the forums, prefixes and the member's saved
// filters are read once it is open.
export default function FeedFiltersPopup({
  tab,
  filter,
  label,
  openedBy,
}: FeedFiltersPopupProps & OpenedProps) {
  const t = useTranslations("forum.feedFilters");
  const router = useRouter();
  const focus = usePopupFocus(openedBy);
  const [open, setOpen] = useState(true);
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const changedHidden = useRef(false);

  // The options are read each time the sheet opens: the popup stays mounted when it closes, and what
  // was saved or hidden in the meantime is on the member's account, not in this copy.
  const cancel = useRef<() => void>(() => {});
  const read = useCallback(() => {
    cancel.current();
    let live = true;
    cancel.current = () => {
      live = false;
    };
    setLoaded({ status: "loading" });
    feedFilterOptions().then(
      (answer) => {
        if (live)
          setLoaded(
            answer.ok
              ? { status: "ready", options: answer.value }
              : { status: "failed" },
          );
      },
      () => {
        if (live) setLoaded({ status: "failed" });
      },
    );
  }, []);
  useEffect(() => {
    read();
    return () => cancel.current();
  }, [read]);

  function close(next: boolean) {
    setOpen(next);
    if (next) read();
    // Forums hidden or shown in the sheet change what the feed lists: draw it again.
    if (!next && changedHidden.current) {
      changedHidden.current = false;
      router.refresh();
    }
  }

  function go(href: string) {
    changedHidden.current = false;
    setOpen(false);
    router.push(href);
  }

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetTrigger
        render={<button type="button" className={FILTERS_BUTTON} />}
      >
        <SlidersHorizontal aria-hidden="true" />
        {label}
      </SheetTrigger>
      <SheetContent
        side="right"
        ref={focus.ref}
        initialFocus={focus.initialFocus}
        className="w-[min(26rem,100vw)] gap-0 sm:max-w-md"
      >
        <SheetHeader className="border-b pr-14">
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>
        {loaded.status === "ready" ? (
          <FiltersForm
            tab={tab}
            filter={filter}
            options={loaded.options}
            go={go}
            onHidden={() => {
              changedHidden.current = true;
            }}
          />
        ) : (
          <p role="status" className="p-4 text-sm text-muted-foreground">
            {loaded.status === "loading" ? t("loading") : t("loadError")}
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}

const sectionLabel = "text-sm font-medium";
const help = "block text-xs text-muted-foreground";
const rowButton =
  "inline-flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

function Tick({
  name,
  checked,
  label,
  note,
}: {
  name: string;
  checked: boolean;
  label: string;
  note: string;
}) {
  return (
    <label className="flex min-h-10 items-start gap-2.5 text-sm">
      <input
        type="checkbox"
        name={name}
        defaultChecked={checked}
        className="mt-1 size-4 shrink-0 accent-primary"
      />
      <span>
        {label}
        <span className={help}>{note}</span>
      </span>
    </label>
  );
}

export function FiltersForm({
  tab,
  filter,
  options,
  go,
  onHidden,
}: {
  tab: HomeTab;
  filter: FeedFilterValue;
  options: FilterOptions;
  go: (href: string) => void;
  onHidden: () => void;
}) {
  const t = useTranslations("forum.feedFilters");
  const form = useRef<HTMLFormElement>(null);
  const [hidden, setHidden] = useState(new Set(options.hiddenForumIds));
  const [saved, setSaved] = useState(options.saved);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const forums = withoutExcluded(options.forums, options.excludedForumIds);

  async function run<T>(
    action: () => Promise<
      { ok: true; value: T } | { ok: false; error: string }
    >,
    done: (value: T) => void,
  ) {
    setBusy(true);
    setError("");
    try {
      const answer = await action();
      if (answer.ok) done(answer.value);
      else setError(answer.error);
    } catch {
      setError(t("loadError"));
    } finally {
      setBusy(false);
    }
  }

  const current = () => readForm(new FormData(form.current ?? undefined), tab);

  return (
    <form
      ref={form}
      onSubmit={(event) => {
        event.preventDefault();
        const { filter: next, target } = current();
        go(feedHref(target, next));
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {options.signedIn && (
          <Tick
            name="followed"
            checked={tab === "following"}
            label={t("followed")}
            note={t("followedHelp")}
          />
        )}
        <div className="space-y-2">
          <p className={sectionLabel}>{t("forumsLabel")}</p>
          <p className={help}>{t("forumsHelp")}</p>
          <ForumChecks
            name="forums"
            label={t("forumsLabel")}
            forums={forums}
            checked={new Set(filter.forumIds ?? [])}
            extra={
              options.signedIn
                ? (forum) => {
                    const isHidden = hidden.has(forum.id);
                    const Icon = isHidden ? EyeOff : Eye;
                    const name = t(isHidden ? "showForum" : "hideForum", {
                      title: forum.title,
                    });
                    return (
                      <button
                        type="button"
                        disabled={busy}
                        aria-pressed={isHidden}
                        aria-label={name}
                        title={name}
                        onClick={() =>
                          run(
                            () => hideFeedForum(forum.id, !isHidden),
                            (ids) => {
                              setHidden(new Set(ids));
                              onHidden();
                            },
                          )
                        }
                        className={`${rowButton} aria-pressed:text-primary-ink`}
                      >
                        <Icon aria-hidden="true" className="size-4" />
                      </button>
                    );
                  }
                : undefined
            }
          />
          {options.signedIn && <p className={help}>{t("hiddenNote")}</p>}
        </div>
        <div className="space-y-2">
          <label htmlFor="feed-filter-prefix" className={sectionLabel}>
            {t("prefixLabel")}
          </label>
          <select
            id="feed-filter-prefix"
            name="prefix"
            defaultValue={filter.prefixId ?? ""}
            className={selectClass}
          >
            <option value="">{t("anyPrefix")}</option>
            {options.prefixes.map((prefix) => (
              <option key={prefix.id} value={prefix.id}>
                {prefix.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label htmlFor="feed-filter-type" className={sectionLabel}>
            {t("typeLabel")}
          </label>
          <select
            id="feed-filter-type"
            name="type"
            defaultValue={filter.type ?? ""}
            className={selectClass}
          >
            <option value="">{t("anyType")}</option>
            {FEED_THREAD_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`types.${type}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label htmlFor="feed-filter-tag" className={sectionLabel}>
            {t("tagLabel")}
          </label>
          <Input
            id="feed-filter-tag"
            name="tag"
            maxLength={100}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={t("tagPlaceholder")}
            defaultValue={filter.tag ?? ""}
            aria-describedby="feed-filter-tag-help"
          />
          <p id="feed-filter-tag-help" className={help}>
            {t("tagHelp")}
          </p>
        </div>
        {options.signedIn ? (
          <div className="space-y-1">
            <Tick
              name="watched"
              checked={filter.watched === true}
              label={t("watchedLabel")}
              note={t("watchedHelp")}
            />
            <Tick
              name="unread"
              checked={filter.unread === true}
              label={t("unreadLabel")}
              note={t("unreadHelp")}
            />
          </div>
        ) : (
          <p className={help}>{t("signInNote")}</p>
        )}
        {options.signedIn && (
          <section
            aria-labelledby="feed-filter-saved"
            className="space-y-2 border-t pt-4"
          >
            <h3 id="feed-filter-saved" className={sectionLabel}>
              {t("savedHeading")}
            </h3>
            {saved.length === 0 ? (
              <p className={help}>{t("savedEmpty")}</p>
            ) : (
              <ul className="divide-y rounded-lg border bg-card">
                {saved.map((entry) => (
                  <li key={entry.id} className="flex items-center pr-1">
                    <button
                      type="button"
                      onClick={() => go(feedHref(entry.scope, entry.filter))}
                      className="min-h-10 min-w-0 flex-1 truncate px-3 text-left text-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {entry.name}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={t("deleteSaved", { name: entry.name })}
                      title={t("deleteSaved", { name: entry.name })}
                      onClick={() =>
                        run(
                          () => deleteFeedFilter(entry.id),
                          (filters) => setSaved(filters),
                        )
                      }
                      className={rowButton}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className={help}>
              {t("savedCount", {
                count: saved.length,
                limit: options.filterLimit,
              })}
            </p>
            <div className="flex gap-2">
              <Input
                name="saveName"
                maxLength={40}
                aria-label={t("saveName")}
                placeholder={t("saveName")}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.preventDefault();
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                className="h-10 shrink-0 md:h-8"
                onClick={() => {
                  const name = String(
                    new FormData(form.current ?? undefined).get("saveName") ??
                      "",
                  ).trim();
                  if (name === "") return;
                  const { filter: next, target } = current();
                  run(
                    () => saveFeedFilter(name, target, next),
                    (filters) => setSaved(filters),
                  );
                }}
              >
                {t("saveButton")}
              </Button>
            </div>
            <p className={help}>{t("saveHelp")}</p>
          </section>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <div className="flex gap-2 border-t p-4">
        <Button type="submit" className="h-10 flex-1 md:h-8">
          {t("apply")}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 md:h-8"
          onClick={() => go(feedHref(tab))}
        >
          {t("clear")}
        </Button>
      </div>
    </form>
  );
}
