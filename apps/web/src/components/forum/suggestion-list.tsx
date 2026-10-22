"use client";

import { type ReactNode, useId, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type Band = { top: number; bottom: number };

// The room kept between the list, the caret's line and the edges.
const GAP = 4;

// Where the list goes: under the caret's line, or over it when there is no room under it in the
// band it can be seen in (`shownBand`), and from the caret's left, inside the box it is drawn in.
// In pixels from that box's corner.
export function suggestionPlace(
  caret: { top: number; bottom: number; left: number },
  box: { top: number; left: number; width: number },
  list: { width: number; height: number },
  shown: Band,
) {
  const below = caret.bottom + GAP + list.height <= shown.bottom;
  const above = caret.top - GAP - list.height >= shown.top;
  const top =
    below || !above ? caret.bottom + GAP : caret.top - GAP - list.height;
  const left = Math.max(
    0,
    Math.min(caret.left - box.left - 2 * GAP, box.width - list.width),
  );
  return { top: top - box.top, left };
}

// The part of the screen the list can be seen in: what the screen shows (a phone's keyboard left
// out) and what each box around the list that clips its overflow shows (a dialog's scroll box).
export function shownBand(bands: Band[]): Band {
  return {
    top: Math.max(...bands.map((band) => band.top)),
    bottom: Math.min(...bands.map((band) => band.bottom)),
  };
}

// The vertical band of each box from `element` up that clips what overflows it.
function clipping(element: Element | null) {
  const bands: Band[] = [];
  for (let at = element; at; at = at.parentElement) {
    if (getComputedStyle(at).overflowY !== "visible") {
      bands.push(at.getBoundingClientRect());
    }
  }
  return bands;
}

// The caret's rectangle on the screen, if the page has one.
function caretRect() {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
  return rect.height ? rect : null;
}

// The list of suggestions a composer offers for what is typed before the caret (emoji after ":",
// members after "@"), drawn by the caret. The focus stays in the text (`owner`): the text points to
// the list and to the active option (`aria-controls`, `aria-activedescendant`), and its keys move
// through it; a press on an option picks it without taking the focus, so a phone keeps its keyboard.
// Drawn only while it has options; `status` is read out as they change.
export function SuggestionList<T>({
  owner,
  label,
  status,
  options,
  active,
  optionKey,
  renderOption,
  onPick,
}: {
  owner: HTMLElement | null;
  label: string;
  status: string;
  options: T[];
  active: number;
  optionKey: (option: T) => string;
  renderOption: (option: T) => ReactNode;
  onPick: (option: T) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const open = options.length > 0;

  useLayoutEffect(() => {
    if (!owner || !open) return;
    owner.setAttribute("aria-autocomplete", "list");
    owner.setAttribute("aria-controls", id);
    owner.setAttribute("aria-activedescendant", `${id}-${active}`);
    return () => {
      owner.removeAttribute("aria-controls");
      owner.removeAttribute("aria-activedescendant");
    };
  }, [owner, open, id, active]);

  // Placed after every change: what is typed moves the caret.
  useLayoutEffect(() => {
    const element = list.current;
    const box = element?.offsetParent;
    const caret = caretRect();
    if (!element || !box || !caret) return;
    const view = window.visualViewport;
    const shownTop = view?.offsetTop ?? 0;
    const place = suggestionPlace(
      caret,
      box.getBoundingClientRect(),
      { width: element.offsetWidth, height: element.offsetHeight },
      shownBand([
        {
          top: shownTop,
          bottom: shownTop + (view?.height ?? window.innerHeight),
        },
        ...clipping(box),
      ]),
    );
    element.style.top = `${place.top}px`;
    element.style.left = `${place.left}px`;
  });

  return (
    <>
      <p role="status" className="sr-only">
        {status}
      </p>
      {open && (
        <div
          ref={list}
          id={id}
          role="listbox"
          aria-label={label}
          className="absolute top-full left-0 z-20 max-h-64 w-72 max-w-full overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {options.map((option, index) => (
            <div
              key={optionKey(option)}
              id={`${id}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm pointer-fine:min-h-9",
                index === active && "bg-muted",
              )}
              // The press picks, and keeps the focus (and a phone's keyboard) in the text. A touch that
              // scrolls the list sends no press.
              onMouseDown={(event) => {
                event.preventDefault();
                onPick(option);
              }}
            >
              {renderOption(option)}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// `text` with the first place it holds `query` (any case) in bold: what was typed, in a suggestion.
export function Matched({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <strong className="font-semibold text-foreground">
        {text.slice(at, at + query.length)}
      </strong>
      {text.slice(at + query.length)}
    </>
  );
}
