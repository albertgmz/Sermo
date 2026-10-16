"use client";

import { Check, ChevronDown, ChevronLeft, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
  type ChoiceRow,
  choiceRows,
  type ForumChoice,
  searchChoices,
} from "@/components/forum/forum-choices";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const ROW =
  "flex min-h-10 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

// The keys of the panel. Enter in the search box would send the form the panel stands in, so it
// does nothing; Escape goes back to the composer.
export function panelKey(
  event: {
    key: string;
    target: EventTarget | { tagName?: string };
    preventDefault: () => void;
    stopPropagation: () => void;
  },
  back: () => void,
) {
  if (
    event.key === "Enter" &&
    "tagName" in event.target &&
    event.target.tagName === "INPUT"
  ) {
    event.preventDefault();
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    back();
  }
}

// A composer's choice of forum, drawn in place of the composer itself: a search box and the forums
// the member may post in, under their categories, which fold. Choosing one hands its id on.
export function ForumChoicePanel({
  forums,
  current,
  onChoose,
  onBack,
}: {
  forums: ForumChoice[];
  // The forum the composer has now; none when one is being chosen for the first time.
  current: number | null;
  onChoose: (id: number) => void;
  onBack: () => void;
}) {
  const t = useTranslations("forum.forumChoicePanel");
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  const searching = query.trim() !== "";
  const rows = searching
    ? searchChoices(forums, query)
    : choiceRows(forums, collapsed);

  useEffect(() => {
    search.current?.focus();
  }, []);

  function toggle(id: number) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function choice(row: ChoiceRow) {
    const chosen = row.id === current;
    return (
      <button
        type="button"
        aria-current={chosen || undefined}
        onClick={() => onChoose(row.id)}
        className={cn(ROW, "flex-1 hover:bg-muted", chosen && "font-semibold")}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate">{row.title}</span>
          {searching && row.trail.length > 0 && (
            <span className="block truncate text-xs font-normal text-muted-foreground">
              {row.trail.join(" › ")}
            </span>
          )}
        </span>
        {chosen && (
          <Check aria-hidden="true" className="size-4 text-primary-ink" />
        )}
      </button>
    );
  }

  return (
    <fieldset
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      onKeyDown={(event) => panelKey(event, onBack)}
    >
      <legend className="sr-only">{t("heading")}</legend>
      <div className="flex items-center gap-2 border-b p-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("aria.back")}
          className="size-10"
          onClick={onBack}
        >
          <ChevronLeft />
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
          {t("heading")}
        </h2>
      </div>
      <div className="relative border-b p-2">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={search}
          type="search"
          aria-label={t("searchLabel")}
          placeholder={t("searchPlaceholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pl-8"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {rows.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {searching ? t("noMatches") : t("noForums")}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {rows.map((row) => (
              <li
                key={row.id}
                style={
                  searching
                    ? undefined
                    : { paddingLeft: `${row.depth * 1.25}rem` }
                }
                className="flex items-center"
              >
                {row.hasChildren && !searching ? (
                  <button
                    type="button"
                    aria-expanded={!collapsed.has(row.id)}
                    aria-label={t(
                      collapsed.has(row.id) ? "aria.expand" : "aria.collapse",
                      { title: row.title },
                    )}
                    onClick={() => toggle(row.id)}
                    className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronDown
                      aria-hidden="true"
                      className={cn(
                        "size-4 transition-transform",
                        collapsed.has(row.id) && "-rotate-90",
                      )}
                    />
                  </button>
                ) : (
                  !searching && (
                    <span aria-hidden="true" className="size-10 shrink-0" />
                  )
                )}
                {row.selectable ? (
                  choice(row)
                ) : (
                  <span
                    className={cn(
                      ROW,
                      "flex-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase",
                    )}
                  >
                    <span className="truncate">{row.title}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </fieldset>
  );
}
