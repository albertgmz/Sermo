"use client";

import { ChevronDown } from "lucide-react";
import type { PrefixSelectPopupProps } from "@/components/forum/prefix-select-popup";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { FIELD_SURFACE } from "@/components/ui/field-surface";
import { LazyPopup } from "@/components/ui/lazy-popup";
import type { PrefixView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

const loadPopup = () => import("@/components/forum/prefix-select-popup");

export type PrefixSelectProps = {
  prefixes: PrefixView[];
  // The chosen prefix's id, "" for none.
  value: string;
  // The choice of no prefix, first in the menu: "(No prefix)" in a form, "All threads" in a
  // forum's filter. Null where the thread must keep a prefix.
  none: string | null;
  // What is chosen ("Prefix"), which names the button with the choice it shows.
  label: string;
  // A form's: called with the id chosen ("" for none).
  onChange?: (value: string) => void;
  // A filter's: the address of each choice, by id ("" for none). Its choices are links.
  hrefs?: Record<string, string>;
  // The button's own look where it sits (joined to a title field).
  className?: string;
};

export const prefixTriggerClass = `${FIELD_SURFACE} group inline-flex h-10 max-w-full shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm outline-none transition-colors select-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-loading:cursor-progress md:h-8 dark:hover:bg-input/50`;

export function chosenPrefix(prefixes: PrefixView[], value: string) {
  return prefixes.find((prefix) => String(prefix.id) === value) ?? null;
}

// The menu's choices in order: the choice of none first (where there is one), then the prefixes
// as the forum orders them. `text` is what typing finds a choice by.
export function menuChoices(prefixes: PrefixView[], none: string | null) {
  return [
    ...(none === null ? [] : [{ value: "", prefix: null, text: none }]),
    ...prefixes.map((prefix) => ({
      value: String(prefix.id),
      prefix,
      text: prefix.label,
    })),
  ];
}

// What the button shows, before and after its menu is loaded: the chosen prefix as its label, or
// the choice of none in muted text, as XenForo's prefix menu does.
export function PrefixFace({
  prefix,
  none,
}: {
  prefix: PrefixView | null;
  none: string | null;
}) {
  return (
    <>
      {prefix ? (
        <PrefixTag prefix={prefix} className="min-w-0 truncate" />
      ) : (
        <span className="min-w-0 truncate text-muted-foreground">{none}</span>
      )}
      <ChevronDown
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground transition-transform group-data-popup-open:rotate-180"
      />
    </>
  );
}

// The button's name: what it chooses and what is chosen ("Prefix: Solved").
export const prefixButtonName = (
  label: string,
  prefix: PrefixView | null,
  none: string | null,
) => `${label}: ${prefix?.label ?? none ?? ""}`;

// The one prefix selector: a button showing the chosen prefix, which opens a menu of the prefixes
// as their coloured labels, the choice of none first. A form's (`onChange`) picks one; a forum's
// filter (`hrefs`) goes to its list. The menu's code (Base UI) is fetched when the button is first
// reached for; the keys are Base UI's (arrows, Home, End, typing a label's first letters, Escape).
export function PrefixSelect(props: PrefixSelectProps) {
  const { prefixes, value, none, label, className } = props;
  const prefix = chosenPrefix(prefixes, value);
  const popup: PrefixSelectPopupProps = props;
  return (
    <LazyPopup
      load={loadPopup}
      popup={popup}
      opening="menu"
      trigger={(lazy) => (
        <button
          type="button"
          data-slot="dropdown-menu-trigger"
          aria-haspopup="menu"
          aria-expanded="false"
          aria-label={prefixButtonName(label, prefix, none)}
          className={cn(prefixTriggerClass, className)}
          {...lazy}
        >
          <PrefixFace prefix={prefix} none={none} />
        </button>
      )}
    />
  );
}
