"use client";

import { ChevronDown, Heart } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { messageActionClass } from "@/components/forum/message-action";
import {
  ReactionPicture,
  type ReactionPictureData,
} from "@/components/forum/reaction-picture";
import {
  type PickerPlacement,
  placePicker,
  VIEWPORT_MARGIN_PX,
} from "@/components/forum/reaction-placement";
import { useReactionGesture } from "@/components/forum/use-reaction-gesture";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { cn } from "@/lib/utils";

// What the picker offers and a summary names: the id is the backend's, the key its string form.
export type ReactionType = {
  id: number;
  key: string;
  label: string;
  emoji: string;
  // Null when the type has no picture or LITE blocks it: the emoji is drawn.
  picture: ReactionPictureData | null;
};

const HOVER_OPEN_MS = 350;
const HOVER_CLOSE_MS = 250;
// How long the backend's refusal stays under the button.
const REFUSAL_MS = 6000;

// The picker is one row while it fits and wraps onto more rows beyond the viewport (staff can add
// any number of reaction types); each button is size-10, the 40px touch target.
export const PICKER_CLASS =
  "w-auto max-w-[calc(100vw-2rem)] flex-row flex-wrap gap-0 rounded-3xl p-1";

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

export function ReactionButton({
  action,
  total,
  viewerTypeId,
  types,
  viewerId,
  authorId,
  size = "default",
  className,
}: {
  // Resolves with the backend's message when it refused the reaction.
  action: (typeId: number | null) => Promise<{ error?: string } | undefined>;
  total: number;
  viewerTypeId: number | null;
  types: ReactionType[];
  viewerId: number | null;
  authorId: number;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const t = useTranslations("forum.reactionButton");
  const [current, setCurrent] = useOptimistic(viewerTypeId);
  const [, startTransition] = useTransition();
  const [refusal, setRefusal] = useState<string>();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [open, setOpen] = useState(false);
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
    startTransition(async () => {
      setCurrent(typeId);
      try {
        // The optimistic value reverts when the transition ends.
        setRefusal((await action(typeId))?.error);
      } catch {
        // Nothing more to say than the revert.
      }
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
            label: (active ?? types[0]).label,
            count,
          })}
          className={buttonClass}
          {...gesture.handlers}
          onClick={() => {
            if (gesture.consumeSwallowedClick()) return;
            choose(current === null ? types[0].id : null);
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
        {...hover}
      >
        {types.map((type) => (
          <button
            key={type.id}
            type="button"
            title={type.label}
            aria-label={type.label}
            aria-pressed={type.id === current}
            data-reaction-id={type.id}
            data-hovered={type.id === gesture.hover}
            onClick={() => choose(type.id === current ? null : type.id)}
            className="group relative flex size-10 select-none items-center justify-center rounded-full text-xl leading-none aria-pressed:bg-muted"
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
        ))}
      </PopoverContent>
    </Popover>
  );
}
