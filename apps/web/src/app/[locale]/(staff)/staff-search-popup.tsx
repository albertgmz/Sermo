"use client";

import { Autocomplete } from "@base-ui/react/autocomplete";
import { XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { revealTarget, targetSelectors } from "@/components/staff/reveal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { OpenedProps } from "@/components/ui/lazy-popup";
import { readStaffSearch } from "./search-action";
import { type Hit, type SearchEntry, searchEntries } from "./search-match";
import { INPUT_ID, TRIGGER, TRIGGER_ID, TriggerFace } from "./staff-search";

// The index, asked for once per language and kept for the life of the page: the panel's pages are
// visited without reloading it. A failed read is asked for again at the next opening.
const indexes = new Map<string, Promise<SearchEntry[]>>();

function indexFor(locale: string) {
  let index = indexes.get(locale);
  if (!index) {
    index = readStaffSearch(locale);
    indexes.set(locale, index);
    index.catch(() => indexes.delete(locale));
  }
  return index;
}

type Loaded = SearchEntry[] | "loading" | "failed";

// Asked for at each opening: the first one reads it, the next ones find it kept, or read it again
// after a failure.
function useIndex(open: boolean): Loaded {
  const locale = useLocale();
  const [loaded, setLoaded] = useState<Loaded>("loading");
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoaded((current) => (current === "failed" ? "loading" : current));
    startTransition(async () => {
      try {
        const entries = await indexFor(locale);
        if (live) setLoaded(entries);
      } catch {
        if (live) setLoaded("failed");
      }
    });
    return () => {
      live = false;
    };
  }, [locale, open]);
  return loaded;
}

const OPTION =
  "group/option flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground";

// The words under the results' list: the hint before a query, what is happening, or that nothing
// matched.
function ListNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 py-6 text-center text-sm text-pretty text-muted-foreground [overflow-wrap:anywhere]">
      {children}
    </p>
  );
}

type Note =
  | { key: "failed" | "loading" | "hint" }
  | { key: "empty"; query: string }
  | null;

// What the words under the box say: that the index could not be read, that it is on its way (once
// something is typed), the hint before a query, or that nothing matched.
export function noteFor(loaded: Loaded, query: string, found: number): Note {
  const typed = query.trim();
  if (loaded === "failed") return { key: "failed" };
  if (!typed) return { key: "hint" };
  if (loaded === "loading") return { key: "loading" };
  return found === 0 ? { key: "empty", query: typed } : null;
}

// What a chosen result does once the search has closed. Another address is opened (`navigate`);
// the address already shown is not opened again, so the row it names is revealed at once
// (`reveal`, the query that names it). With no row to reveal, the page's main region takes the
// focus, which the box would otherwise keep.
export function afterPick(
  href: string,
  here: { pathname: string; search: string },
): { navigate: boolean; reveal: string | null } {
  const to = new URL(href, "http://panel");
  const same = to.pathname === here.pathname && to.search === here.search;
  return {
    navigate: !same,
    reveal: same && targetSelectors(to.search).length > 0 ? to.search : null,
  };
}

// The box and its results: Base UI's combobox with the list drawn in place (the arrow keys move
// through the results, Enter opens the highlighted one, which is the best match until the keys
// move it). `onOpen` takes the chosen result's address.
export function SearchPanel({
  loaded,
  query,
  onQuery,
  onOpen,
}: {
  loaded: Loaded;
  query: string;
  onQuery: (query: string) => void;
  onOpen: (href: string) => void;
}) {
  const t = useTranslations("admin.staffSearch");
  const dialog = useTranslations("ui.dialog");
  const hits: Hit[] = useMemo(
    () => (Array.isArray(loaded) ? searchEntries(loaded, query) : []),
    [loaded, query],
  );
  const typed = query.trim() !== "";
  const note = noteFor(loaded, query, hits.length);
  return (
    <Autocomplete.Root
      items={hits}
      filter={null}
      value={query}
      onValueChange={onQuery}
      itemToStringValue={(hit: Hit) => hit.entry.label}
      inline
      open
      autoHighlight="always"
    >
      <div className="flex items-center gap-2 border-b ps-3 pe-1.5">
        <Autocomplete.Input
          id={INPUT_ID}
          aria-label={t("title")}
          placeholder={t("placeholder")}
          autoComplete="off"
          spellCheck={false}
          className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-10 shrink-0 text-muted-foreground"
            />
          }
        >
          <XIcon />
          <span className="sr-only">{dialog("aria.close")}</span>
        </DialogClose>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-2">
        <Autocomplete.Status className="sr-only">
          {typed && Array.isArray(loaded)
            ? t("count", { count: hits.length })
            : null}
        </Autocomplete.Status>
        {note && (
          <ListNote>
            {note.key === "empty"
              ? t("empty", { query: note.query })
              : t(note.key)}
          </ListNote>
        )}
        <Autocomplete.List className="space-y-0.5 empty:hidden">
          {(hit: Hit) => (
            <Autocomplete.Item
              key={hit.entry.href}
              value={hit}
              onClick={() => onOpen(hit.entry.href)}
              className={OPTION}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {hit.entry.label}
                </span>
                {(hit.entry.path.length > 0 || hit.via === "id") && (
                  <span className="block truncate text-xs text-muted-foreground group-data-highlighted/option:text-accent-foreground">
                    {hit.entry.path.join(" › ")}
                    {hit.via === "id" && (
                      <>
                        {hit.entry.path.length > 0 && " · "}
                        <span className="font-mono">{hit.entry.id}</span>
                      </>
                    )}
                  </span>
                )}
              </span>
              <span className="shrink-0 rounded-sm border px-1.5 text-xs text-muted-foreground group-data-highlighted/option:border-accent-foreground/30 group-data-highlighted/option:text-accent-foreground">
                {t(`kinds.${hit.entry.kind}`)}
              </span>
            </Autocomplete.Item>
          )}
        </Autocomplete.List>
      </div>
      <p
        aria-hidden="true"
        className="hidden gap-4 border-t px-4 py-2 text-xs text-muted-foreground sm:flex"
      >
        <span>
          <kbd className="font-sans">↑↓</kbd> {t("keys.move")}
        </span>
        <span>
          <kbd className="font-sans">↵</kbd> {t("keys.open")}
        </span>
        <span>
          <kbd className="font-sans">Esc</kbd> {t("keys.close")}
        </span>
      </p>
    </Autocomplete.Root>
  );
}

// The dialog the box opens, and the box's own button. It mounts open; the query starts empty at
// every opening. A chosen result closes the search without handing the focus back to the box: the
// screen it opens takes it (the row of a setting or a permission is focused there, the main region
// otherwise).
export default function StaffSearchPopup(_: OpenedProps) {
  const t = useTranslations("admin.staffSearch");
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  const leaving = useRef(false);
  // The chosen result, acted on once the dialog is gone.
  const picked = useRef<ReturnType<typeof afterPick> | null>(null);
  const loaded = useIndex(open);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          leaving.current = false;
          setQuery("");
        }
        setOpen(next);
      }}
      onOpenChangeComplete={(isOpen) => {
        const pick = picked.current;
        picked.current = null;
        if (isOpen || !pick) return;
        // The panel's <main> takes the focus (`tabIndex={-1}`).
        const main = document.querySelector<HTMLElement>("main");
        if (pick.reveal && main && revealTarget(main, pick.reveal)) return;
        main?.focus({ preventScroll: true });
      }}
    >
      <DialogTrigger
        id={TRIGGER_ID}
        aria-keyshortcuts="Control+K Meta+K"
        className={TRIGGER}
      >
        <TriggerFace />
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        initialFocus={() => document.getElementById(INPUT_ID) ?? true}
        finalFocus={() => !leaving.current}
        className="top-3 grid max-h-[calc(100dvh-1.5rem)] translate-y-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:top-[12vh] sm:max-h-[min(36rem,76dvh)] sm:max-w-xl"
      >
        <DialogTitle className="sr-only">{t("title")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("description")}
        </DialogDescription>
        <SearchPanel
          loaded={loaded}
          query={query}
          onQuery={setQuery}
          onOpen={(href) => {
            const pick = afterPick(href, window.location);
            leaving.current = true;
            picked.current = pick;
            setOpen(false);
            if (pick.navigate) router.push(href);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
