"use client";

import { Check, ChevronDown, ChevronLeft, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { ForumChoiceArt } from "@/components/forum/forum-choice-art";
import {
  type ChoiceRow,
  type ChoiceSection,
  choiceRows,
  choiceSections,
  type ForumChoice,
  searchChoices,
} from "@/components/forum/forum-choices";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// One column on a phone, two from a card as wide as the Create dialog's, three in the composer's
// page; by the width of the list itself, which differs between the two.
const GRID = "grid gap-2 @lg:grid-cols-2 @4xl:grid-cols-3";

// What a forum without a picture shows in its place: its first letter.
export const monogram = (title: string) =>
  Array.from(title.trim())[0]?.toLocaleUpperCase() ?? "";

// A forum to choose, drawn as a small banner. A cover lies behind the title, faded into the tile
// under the text by a scrim of the tile's own colour, so the title reads on any picture in both
// themes. An icon, or without a picture the forum's letter, sits in a square at the end, over a
// light wash of the accent.
export function ForumTile({
  row,
  chosen,
  trail,
  onChoose,
}: {
  row: ChoiceRow;
  chosen: boolean;
  // The titles above it, for a result shown out of its place.
  trail: boolean;
  onChoose: (id: number) => void;
}) {
  const cover = row.image?.kind === "cover" ? row.image.url : null;
  const icon = row.image?.kind === "icon" ? row.image.url : null;
  return (
    <li className="min-w-0">
      <button
        type="button"
        aria-current={chosen || undefined}
        data-forum-tile={row.image?.kind ?? "plain"}
        onClick={() => onChoose(row.id)}
        className={cn(
          "group/tile relative isolate flex h-16 w-full min-w-0 items-center gap-3 overflow-hidden rounded-lg border bg-card px-3 text-left outline-none transition-colors hover:border-ring focus-visible:ring-2 focus-visible:ring-ring",
          chosen && "border-primary",
        )}
      >
        {cover ? (
          <>
            <ForumChoiceArt
              url={cover}
              className="absolute inset-0 -z-20 size-full transition-transform duration-300 motion-safe:group-hover/tile:scale-[1.04]"
            />
            <span
              aria-hidden="true"
              className="absolute inset-0 -z-10 bg-linear-to-r from-card from-30% via-card/80 via-55% to-card/0"
            />
          </>
        ) : (
          <span
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-linear-to-l from-primary/10 to-transparent to-70%"
          />
        )}
        <span className={cn("min-w-0 flex-1", cover && "max-w-[64%]")}>
          <span className="block truncate text-sm font-semibold">
            {row.title}
          </span>
          {trail && row.trail.length > 0 && (
            <span className="block truncate text-xs text-foreground/75">
              {row.trail.join(" › ")}
            </span>
          )}
        </span>
        {icon ? (
          <ForumChoiceArt
            url={icon}
            className="size-10 shrink-0 rounded-md border"
          />
        ) : (
          !cover && (
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-lg font-bold text-primary-ink"
            >
              {monogram(row.title)}
            </span>
          )
        )}
        {chosen && (
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground",
              cover && "ml-auto",
            )}
          >
            <Check aria-hidden="true" className="size-3.5" />
          </span>
        )}
      </button>
    </li>
  );
}

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
// the member may post in, as tiles under their categories, which fold. Choosing one hands its id on.
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
  const sections: ChoiceSection[] = searching
    ? [{ heading: null, items: searchChoices(forums, query) }]
    : choiceSections(choiceRows(forums, collapsed));
  // Folded headings still show; only a search without a match, or no forum at all, is empty.
  const empty = sections.every(
    (section) => !section.heading && section.items.length === 0,
  );

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
      <div className="@container min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-3 md:min-h-72 md:px-3">
        {empty ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {searching ? t("noMatches") : t("noForums")}
          </p>
        ) : (
          sections.map((section, index) => {
            const heading = section.heading;
            const open = !heading || !collapsed.has(heading.id);
            return (
              <section
                key={heading?.id ?? `root-${section.items[0]?.id}`}
                className="pt-2"
              >
                {heading && (
                  <h3>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggle(heading.id)}
                      className="flex min-h-9 w-full min-w-0 items-center gap-1.5 rounded-md px-1 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronDown
                        aria-hidden="true"
                        className={cn(
                          "size-4 shrink-0 transition-transform",
                          !open && "-rotate-90",
                        )}
                      />
                      <span className="min-w-0 truncate">
                        {heading.trail.length > 0 && (
                          <span className="font-normal">
                            {heading.trail.join(" › ")} ›{" "}
                          </span>
                        )}
                        {heading.title}
                      </span>
                    </button>
                  </h3>
                )}
                {!heading && index > 0 && (
                  <h3 className="flex min-h-9 items-center px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {t("moreForums")}
                  </h3>
                )}
                {section.items.length > 0 && (
                  <ul className={cn(GRID, (heading || index > 0) && "mt-1")}>
                    {section.items.map((row) => (
                      <ForumTile
                        key={row.id}
                        row={row}
                        chosen={row.id === current}
                        trail={searching}
                        onChoose={onChoose}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })
        )}
      </div>
    </fieldset>
  );
}
