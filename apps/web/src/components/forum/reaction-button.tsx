"use client";

import { ChevronDown, Heart, Lock } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { messageActionClass } from "@/components/forum/message-action";
import {
  ReactionPicture,
  type ReactionPictureData,
} from "@/components/forum/reaction-picture";
import {
  type PickerGrid,
  type PickerPlacement,
  pickerGrid,
  placePicker,
  VIEWPORT_MARGIN_PX,
} from "@/components/forum/reaction-placement";
import { useReactionGesture } from "@/components/forum/use-reaction-gesture";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { changeItem, useItemState } from "@/lib/item-state";
import { cn } from "@/lib/utils";

// What the picker offers and a summary names: the id is the backend's, the key its string form.
export type ReactionType = {
  id: number;
  key: string;
  label: string;
  emoji: string;
  // Null when the type has no picture or LITE blocks it: the emoji is drawn.
  picture: ReactionPictureData | null;
  // Set when the viewer may not give it yet: why, in words. The picker shows it greyed with a
  // padlock; it cannot be chosen. The backend refuses it as well.
  locked?: string;
  // Set on the viewer's own reaction when its type is no longer offered (hidden, or limited to
  // other forums): drawn greyed, and pressing it takes the reaction back.
  kept?: true;
};

const HOVER_OPEN_MS = 350;
const HOVER_CLOSE_MS = 250;
// How long the backend's refusal stays under the button.
const REFUSAL_MS = 6000;

// The picker is a grid of square reactions, two even rows while they fit (`pickerGrid`); its
// width never outgrows the viewport.
export const PICKER_CLASS =
  "grid w-auto max-w-[calc(100vw-2rem)] gap-0 rounded-3xl p-1";

// The columns and the reactions' size from `pickerGrid`. The picture is 1.25em of the font size,
// about two thirds of its square: 35px in a 52px reaction, 27px in a 40px one.
export function pickerStyle({ columns, cell }: PickerGrid) {
  return {
    gridTemplateColumns: `repeat(${columns}, ${cell}px)`,
    gridAutoRows: `${cell}px`,
    fontSize: `${Math.round(cell * 0.54)}px`,
  };
}

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

const SIZES = {
  default: "",
  sm: "text-(length:--text-caption) md:h-7 md:min-w-7 [&_svg]:size-3.5",
};

export function ReactionButton(props: {
  // What the viewer's reaction on this item is kept under, so that everything that shows it
  // follows the change without the page being drawn again.
  stateKey: string;
  // Resolves with the backend's message when it refused the reaction.
  action: (
    typeId: number | null,
  ) => Promise<{ error?: string; signIn?: string } | undefined>;
  total: number;
  viewerTypeId: number | null;
  types: ReactionType[];
  viewerId: number | null;
  authorId: number;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const {
    stateKey,
    action,
    total,
    viewerTypeId,
    types,
    viewerId,
    authorId,
    size = "default",
    className,
  } = props;
  const t = useTranslations("forum.reactionButton");
  const tFailed = useTranslations("lib.errors");
  const router = useRouter();
  const current = useItemState(stateKey, viewerTypeId, props);
  const [refusal, setRefusal] = useState<string>();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [open, setOpen] = useState(false);
  // The locked reaction pressed (or pointed at) last: its hint is drawn over it, as touch has no hover.
  const [lockedNote, setLockedNote] = useState<ReactionType>();
  const [placement, setPlacement] = useState<PickerPlacement>();
  const anchor = useRef<HTMLSpanElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const viaTrigger = useRef(false);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!refusal) return;
    const hide = setTimeout(() => setRefusal(undefined), REFUSAL_MS);
    return () => clearTimeout(hide);
  }, [refusal]);

  const gesture = useReactionGesture({
    picker,
    given: current,
    open: () => {
      clearTimeout(timer.current);
      viaTrigger.current = false;
      show(true);
    },
    close: () => {
      clearTimeout(timer.current);
      show(false);
    },
    choose: (typeId) => choose(typeId),
  });

  const buttonClass = cn(
    messageActionClass,
    "select-none touch-manipulation [-webkit-touch-callout:none]",
    SIZES[size],
  );
  const active = types.find((type) => type.id === current);
  // A tap on the button gives the first reaction the viewer may give.
  const first = types.find((type) => type.locked === undefined && !type.kept);
  const count =
    total - Number(viewerTypeId !== null) + Number(current !== null);
  const content = (
    <>
      {active ? (
        <ReactionPicture
          emoji={active.emoji}
          picture={active.picture}
          className="text-base leading-none"
        />
      ) : (
        <Heart />
      )}
      {count > 0 && count}
    </>
  );

  if (viewerId === null) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(pathname + (search ? `?${search}` : ""))}`}
        aria-label={t("aria.login", { count })}
        className={cn(buttonClass, className)}
      >
        {content}
      </Link>
    );
  }
  if (viewerId === authorId || types.length === 0) return null;

  function show(next: boolean) {
    const rect = anchor.current?.getBoundingClientRect();
    if (next && rect) {
      setPlacement(
        placePicker({
          anchor: rect,
          count: types.length,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
      );
    }
    if (!next) setLockedNote(undefined);
    setOpen(next);
  }

  function schedule(next: boolean, delay: number) {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      viaTrigger.current = false;
      show(next);
    }, delay);
  }

  function choose(typeId: number | null) {
    clearTimeout(timer.current);
    if (open && viaTrigger.current) gesture.button.current?.focus();
    show(false);
    setRefusal(undefined);
    // Shown at once; a refusal puts the old reaction back and says why, and a session that has
    // ended sends the member to sign in.
    void changeItem(
      stateKey,
      viewerTypeId,
      typeId,
      () => action(typeId),
      tFailed("generic"),
    ).then(({ error, signIn }) => {
      if (signIn) router.push(signIn);
      else setRefusal(error);
    });
  }

  const hover = {
    onPointerEnter: (event: React.PointerEvent) => {
      // Right after a drag the enter is the capture letting go: it must not open the picker again.
      if (event.pointerType === "mouse" && !gesture.justReleased()) {
        schedule(true, HOVER_OPEN_MS);
      }
    },
    onPointerLeave: (event: React.PointerEvent) => {
      if (event.pointerType !== "mouse") clearTimeout(timer.current);
      // Right after a drag the leave is the capture letting go: the picker stays for a click.
      else if (!gesture.justReleased()) schedule(false, HOVER_CLOSE_MS);
    },
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        const pressedAnchor =
          details.reason === "outside-press" &&
          anchor.current?.contains(details.event.target as Node);
        if (pressedAnchor) return;
        if (next) viaTrigger.current = details.reason === "trigger-press";
        show(next);
      }}
    >
      <span
        ref={anchor}
        className={cn("inline-flex items-center", className)}
        {...hover}
      >
        <button
          ref={gesture.buttonRef}
          type="button"
          aria-pressed={current !== null}
          aria-label={t("aria.state", {
            label: (active ?? first ?? types[0]).label,
            count,
          })}
          className={buttonClass}
          {...gesture.handlers}
          onClick={() => {
            if (gesture.consumeSwallowedClick()) return;
            if (current !== null) choose(null);
            else if (first) choose(first.id);
            else show(true);
          }}
        >
          {content}
        </button>
        <PopoverTrigger
          aria-label={t("aria.choose")}
          className="sr-only inline-flex items-center justify-center rounded-md text-muted-foreground focus-visible:not-sr-only focus-visible:size-10 md:focus-visible:size-8"
        >
          <ChevronDown className="size-4" />
        </PopoverTrigger>
        {refusal && (
          <span role="alert" className="ml-1 text-xs text-destructive">
            {refusal}
          </span>
        )}
      </span>
      <PopoverContent
        ref={picker}
        side={placement?.side ?? "top"}
        sideOffset={placement?.sideOffset}
        alignOffset={placement?.alignOffset}
        align="start"
        anchor={anchor}
        aria-label={t("aria.choose")}
        initialFocus={() => viaTrigger.current}
        finalFocus={() => (viaTrigger.current ? gesture.button.current : false)}
        className={PICKER_CLASS}
        style={pickerStyle(
          placement?.grid ?? pickerGrid(types.length, Number.POSITIVE_INFINITY),
        )}
        {...hover}
      >
        {types.map((type) =>
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
              className="relative flex size-full select-none items-center justify-center rounded-full bg-muted leading-none"
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
              className="relative flex size-full select-none items-center justify-center rounded-full leading-none aria-pressed:bg-muted"
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
              data-hovered={type.id === gesture.hover}
              onClick={() => choose(type.id === current ? null : type.id)}
              className="group relative flex size-full select-none items-center justify-center rounded-full leading-none aria-pressed:bg-muted"
            >
              <span className="flex transition-transform group-hover:scale-125 group-focus-visible:scale-125 group-data-[hovered=true]:-translate-y-1 group-data-[hovered=true]:scale-150">
                <ReactionPicture emoji={type.emoji} picture={type.picture} />
              </span>
              {type.id === gesture.hover && (
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
      </PopoverContent>
    </Popover>
  );
}
