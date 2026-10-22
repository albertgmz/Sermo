"use client";

import { ChevronDown, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { type RefObject, useState } from "react";
import {
  PICKER_CLASS,
  PICKER_TRIGGER_CLASS,
  pickerRows,
  pickerStyle,
  type ReactionType,
} from "@/components/forum/reaction-button";
import { ReactionPicture } from "@/components/forum/reaction-picture";
import {
  type PickerPlacement,
  pickerGrid,
  VIEWPORT_MARGIN_PX,
} from "@/components/forum/reaction-placement";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Shifts a label that runs past the screen's margin back inside it.
function keepInViewport(node: HTMLElement | null) {
  if (!node) return;
  node.style.translate = "";
  const rect = node.getBoundingClientRect();
  const left = VIEWPORT_MARGIN_PX - rect.left;
  const right = window.innerWidth - VIEWPORT_MARGIN_PX - rect.right;
  const shift = left > 0 ? left : right < 0 ? right : 0;
  if (shift !== 0) node.style.translate = `${shift}px 0`;
}

type Hover = {
  onPointerEnter: (event: React.PointerEvent) => void;
  onPointerLeave: (event: React.PointerEvent) => void;
};

export type ReactionPickerProps = {
  open: boolean;
  onOpenChange: (
    next: boolean,
    details: { reason: string; event: Event },
  ) => void;
  // The button's box: the picker is placed against it, and a press on it is no press outside.
  anchor: RefObject<HTMLSpanElement | null>;
  picker: RefObject<HTMLDivElement | null>;
  placement?: PickerPlacement;
  types: ReactionType[];
  current: number | null;
  // The reaction under the finger while it slides.
  hovered: number | null;
  hover: Hover;
  // The picker was opened from its own trigger (the keyboard's way in): focus goes into it, and
  // back to the button when it closes.
  viaTrigger: RefObject<boolean>;
  button: RefObject<HTMLButtonElement | null>;
  choose: (typeId: number | null) => void;
};

// The picker of `ReactionButton`, which Base UI draws: its trigger for the keyboard (the button
// itself is not one) and the reactions. Its code is fetched when the button is first reached for,
// and it is drawn in place of the plain trigger once the picker is asked for.
export default function ReactionPicker({
  open,
  onOpenChange,
  anchor,
  picker,
  placement,
  types,
  current,
  hovered,
  hover,
  viaTrigger,
  button,
  choose,
}: ReactionPickerProps) {
  const t = useTranslations("forum.reactionButton");
  const grid =
    placement?.grid ?? pickerGrid(types.length, Number.POSITIVE_INFINITY);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        aria-label={t("aria.choose")}
        className={PICKER_TRIGGER_CLASS}
      >
        <ChevronDown className="size-4" />
      </PopoverTrigger>
      <PopoverContent
        ref={picker}
        side={placement?.side ?? "top"}
        sideOffset={placement?.sideOffset}
        alignOffset={placement?.alignOffset}
        align="start"
        anchor={anchor}
        aria-label={t("aria.choose")}
        initialFocus={() => viaTrigger.current}
        finalFocus={() => (viaTrigger.current ? button.current : false)}
        className={PICKER_CLASS}
        style={pickerStyle(grid)}
        {...hover}
      >
        <PickerRows
          rows={pickerRows(types, grid.rows)}
          current={current}
          hovered={hovered}
          choose={choose}
        />
      </PopoverContent>
    </Popover>
  );
}

// The reactions, drawn while the picker is open: the locked reaction whose hint shows is forgotten
// when it closes.
function PickerRows({
  rows,
  current,
  hovered,
  choose,
}: {
  rows: ReactionType[][];
  current: number | null;
  hovered: number | null;
  choose: (typeId: number | null) => void;
}) {
  const t = useTranslations("forum.reactionButton");
  // The locked reaction pressed (or pointed at) last: its hint is drawn over it, as touch has no hover.
  const [lockedNote, setLockedNote] = useState<ReactionType>();
  return rows.map((row) => (
    <div key={row[0]?.id} className="flex">
      {row.map((type) =>
        type.kept ? (
          // The viewer's own reaction, whose type is no longer offered: greyed, and pressing it
          // takes it back.
          <button
            key={type.id}
            type="button"
            title={type.label}
            aria-label={t("aria.kept", { label: type.label })}
            aria-pressed="true"
            onClick={() => choose(null)}
            className="relative flex size-(--cell) select-none items-center justify-center rounded-full bg-muted leading-none"
          >
            <span className="flex opacity-60 grayscale">
              <ReactionPicture emoji={type.emoji} picture={type.picture} />
            </span>
          </button>
        ) : type.locked !== undefined ? (
          <button
            key={type.id}
            type="button"
            title={`${type.label}: ${type.locked}`}
            aria-label={t("aria.locked", {
              label: type.label,
              hint: type.locked,
            })}
            aria-disabled="true"
            aria-pressed={type.id === current}
            onClick={() =>
              type.id === current ? choose(null) : setLockedNote(type)
            }
            onFocus={() => setLockedNote(type)}
            onPointerEnter={(event) =>
              event.pointerType === "mouse" && setLockedNote(type)
            }
            onPointerLeave={() =>
              setLockedNote((now) => (now?.id === type.id ? undefined : now))
            }
            className="relative flex size-(--cell) select-none items-center justify-center rounded-full leading-none aria-pressed:bg-muted"
          >
            <span className="flex opacity-40 grayscale">
              <ReactionPicture emoji={type.emoji} picture={type.picture} />
            </span>
            <Lock
              aria-hidden="true"
              className="absolute bottom-1 right-1 size-3.5 text-foreground"
            />
            {lockedNote?.id === type.id && type.locked && (
              // The hint rides on the label bubble: out of the layout, so the picker keeps the
              // size `placePicker` measured. It may wrap, and is pulled back inside the screen.
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-full left-1/2 mb-2 flex w-0 justify-center"
              >
                <span
                  ref={keepInViewport}
                  className="w-max shrink-0 max-w-[min(18rem,calc(100vw-2rem))] rounded-2xl bg-foreground px-2 py-1 text-center text-xs leading-normal text-background"
                >
                  {type.locked}
                </span>
              </span>
            )}
          </button>
        ) : (
          <button
            key={type.id}
            type="button"
            title={type.label}
            aria-label={type.label}
            aria-pressed={type.id === current}
            data-reaction-id={type.id}
            data-hovered={type.id === hovered}
            onClick={() => choose(type.id === current ? null : type.id)}
            className="group relative flex size-(--cell) select-none items-center justify-center rounded-full leading-none aria-pressed:bg-muted"
          >
            <span className="flex transition-transform group-hover:scale-125 group-focus-visible:scale-125 group-data-[hovered=true]:-translate-y-1 group-data-[hovered=true]:scale-150">
              <ReactionPicture emoji={type.emoji} picture={type.picture} />
            </span>
            {type.id === hovered && (
              // Zero wide and centred on the reaction; the label is pulled back inside the screen.
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-full left-1/2 mb-2 flex w-0 justify-center"
              >
                <span
                  ref={keepInViewport}
                  className="whitespace-nowrap rounded-full bg-foreground px-2 py-0.5 text-xs leading-normal text-background"
                >
                  {type.label}
                </span>
              </span>
            )}
          </button>
        ),
      )}
    </div>
  ));
}
