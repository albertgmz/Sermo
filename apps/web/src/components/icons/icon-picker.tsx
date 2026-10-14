"use client";

// IconPicker: choose one icon of the site's set (`icon-set.ts`), or none. It knows nothing about
// what the icon is for. The choice travels in a hidden input, so it works inside a server-action
// form like any other field.
//
// IconPicker props
//   name          Name of the hidden input; the form data carries the chosen key, "" for none.
//   defaultValue  The key chosen at the start; null or omitted for none. A key the set does not
//                 know is kept (and shown as text) until another choice replaces it.
//   id            Id of the trigger, for a label's htmlFor.
//   className     Classes of the trigger.
//
// Use it:  <IconPicker name="icon" defaultValue={entry.icon} id="icon" />
//          and read formData.get("icon") in the action ("" means none).
//
// Keyboard: the search field has focus when the popover opens; ArrowDown moves into the grid,
// the arrows move between icons (ArrowUp from the first row returns to the search), Enter or
// Space chooses, Escape closes and focus returns to the trigger.

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import {
  ICON_ENTRIES,
  type IconEntry,
  searchIcons,
} from "@/components/icons/icon-meta";
import { iconComponent } from "@/components/icons/icon-set";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Six 40px icons fit the 288px popover on a 360px phone, and ArrowUp / ArrowDown move by a row.
const COLUMNS = 6;

export function IconGrid({
  entries,
  value,
  onChoose,
}: {
  entries: IconEntry[];
  value: string | null;
  onChoose: (key: string) => void;
}) {
  const t = useTranslations("ui.iconPicker");
  if (entries.length === 0)
    return <p className="px-1 py-3 text-muted-foreground">{t("empty")}</p>;
  return (
    <fieldset
      aria-label={t("aria.grid")}
      className="m-0 grid max-h-64 min-w-0 grid-cols-6 gap-1 overflow-y-auto border-0 p-0"
    >
      {entries.map((entry) => {
        const Icon = iconComponent(entry.key);
        return (
          <button
            key={entry.key}
            type="button"
            data-icon-option=""
            title={entry.label}
            aria-label={entry.label}
            aria-pressed={entry.key === value}
            onClick={() => onChoose(entry.key)}
            className="flex size-10 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:text-primary"
          >
            {Icon && <Icon className="size-5" aria-hidden="true" />}
          </button>
        );
      })}
    </fieldset>
  );
}

// Moves focus between the icons of the grid by arrow keys.
function moveFocus(
  event: React.KeyboardEvent<HTMLElement>,
  search: HTMLElement,
) {
  const grid = event.currentTarget;
  const options = [...grid.querySelectorAll<HTMLElement>("[data-icon-option]")];
  const at = options.indexOf(event.target as HTMLElement);
  if (at < 0) return;
  const step: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -COLUMNS,
    ArrowDown: COLUMNS,
  };
  let to: number | undefined;
  if (event.key === "Home") to = 0;
  else if (event.key === "End") to = options.length - 1;
  else if (event.key in step) {
    to = at + step[event.key];
    if (to < 0 && event.key === "ArrowUp") {
      event.preventDefault();
      search.focus();
      return;
    }
    to = Math.min(Math.max(to, 0), options.length - 1);
  }
  if (to === undefined) return;
  event.preventDefault();
  options[to]?.focus();
}

export function IconPicker({
  name,
  defaultValue = null,
  id,
  className,
}: {
  name: string;
  defaultValue?: string | null;
  id?: string;
  className?: string;
}) {
  const t = useTranslations("ui.iconPicker");
  const [value, setValue] = useState<string | null>(defaultValue || null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const known = ICON_ENTRIES.find((entry) => entry.key === value);
  const Current = iconComponent(value);

  function choose(key: string | null) {
    setValue(key);
    setOpen(false);
  }

  return (
    <>
      <input type="hidden" name={name} value={value ?? ""} />
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setQuery("");
        }}
      >
        <PopoverTrigger
          id={id}
          render={
            <Button
              type="button"
              variant="outline"
              className={cn(
                "h-10 min-w-40 justify-between gap-2 px-2.5 md:h-8",
                className,
              )}
            />
          }
        >
          <span className="flex min-w-0 items-center gap-2">
            {Current && <Current className="size-4" aria-hidden="true" />}
            <span className="truncate">
              {value ? (known?.label ?? value) : t("none")}
            </span>
          </span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label={t("aria.choose")}
          initialFocus={search}
          className="max-w-[calc(100vw-2rem)]"
        >
          <Input
            ref={search}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                const first = event.currentTarget
                  .closest("[data-slot=popover-content]")
                  ?.querySelector<HTMLElement>("[data-icon-option]");
                if (first) {
                  event.preventDefault();
                  first.focus();
                }
              }
            }}
            placeholder={t("searchPlaceholder")}
            aria-label={t("aria.search")}
            autoComplete="off"
            className="[&::-webkit-search-cancel-button]:hidden"
          />
          <Button
            type="button"
            variant="ghost"
            aria-pressed={value === null}
            onClick={() => choose(null)}
            className="h-10 justify-start px-2.5 aria-pressed:bg-muted aria-pressed:text-primary md:h-8"
          >
            {t("none")}
          </Button>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys bubble up from the icon buttons, which are the interactive elements */}
          <div
            onKeyDown={(event) => {
              if (search.current) moveFocus(event, search.current);
            }}
          >
            <IconGrid
              entries={searchIcons(query)}
              value={value}
              onChoose={choose}
            />
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
