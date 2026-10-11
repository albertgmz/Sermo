"use client";

import { ChevronDown, Heart } from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { messageActionClass } from "@/components/forum/message-action";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ReactionType } from "@/lib/types";
import { cn } from "@/lib/utils";

const HOVER_OPEN_MS = 350;
const HOVER_CLOSE_MS = 250;
const LONG_PRESS_MS = 450;

const SIZES = {
  default: "",
  sm: "text-[0.6875rem] md:h-7 md:min-w-7 [&_svg]:size-3.5",
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
  action: (typeId: number | null) => Promise<void>;
  total: number;
  viewerTypeId: number | null;
  types: ReactionType[];
  viewerId: number | null;
  authorId: number;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [current, setCurrent] = useOptimistic(viewerTypeId);
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const touch = useRef(false);
  const longPressed = useRef(false);
  const viaTrigger = useRef(false);

  useEffect(() => () => clearTimeout(timer.current), []);

  const buttonClass = cn(
    messageActionClass,
    "select-none touch-manipulation [-webkit-touch-callout:none]",
    SIZES[size],
  );
  const active = types.find((type) => type.id === current);
  const count =
    total - Number(viewerTypeId !== null) + Number(current !== null);
  const summary = `${count} ${count === 1 ? "reaction" : "reactions"}`;
  const content = (
    <>
      {active ? (
        <span aria-hidden="true" className="text-base leading-none">
          {active.emoji}
        </span>
      ) : (
        <Heart />
      )}
      {count > 0 && count}
    </>
  );

  if (viewerId === null) {
    return (
      <Link
        href="/login"
        aria-label={`Log in to react, ${summary}`}
        className={cn(buttonClass, className)}
      >
        {content}
      </Link>
    );
  }
  if (viewerId === authorId || types.length === 0) return null;

  function show(next: boolean) {
    if (!next) longPressed.current = false;
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
    if (open && viaTrigger.current) button.current?.focus();
    show(false);
    startTransition(async () => {
      setCurrent(typeId);
      try {
        await action(typeId);
      } catch {
        // The optimistic value reverts when the transition ends.
      }
    });
  }

  const hover = {
    onPointerEnter: (event: React.PointerEvent) => {
      if (event.pointerType === "mouse") schedule(true, HOVER_OPEN_MS);
    },
    onPointerLeave: (event: React.PointerEvent) => {
      if (event.pointerType === "mouse") schedule(false, HOVER_CLOSE_MS);
      else clearTimeout(timer.current);
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
          ref={button}
          type="button"
          aria-pressed={current !== null}
          aria-label={`${(active ?? types[0]).label}, ${summary}`}
          className={buttonClass}
          onPointerDown={(event) => {
            longPressed.current = false;
            touch.current = event.pointerType !== "mouse";
            if (!touch.current) return;
            clearTimeout(timer.current);
            timer.current = setTimeout(() => {
              longPressed.current = true;
              viaTrigger.current = false;
              setOpen(true);
            }, LONG_PRESS_MS);
          }}
          onPointerUp={() => {
            if (touch.current) clearTimeout(timer.current);
          }}
          onPointerCancel={() => clearTimeout(timer.current)}
          onContextMenu={(event) => {
            if (touch.current) event.preventDefault();
          }}
          onClick={() => {
            if (longPressed.current) {
              longPressed.current = false;
              return;
            }
            choose(current === null ? types[0].id : null);
          }}
        >
          {content}
        </button>
        <PopoverTrigger
          aria-label="Choose a reaction"
          className="sr-only inline-flex items-center justify-center rounded-md text-muted-foreground focus-visible:not-sr-only focus-visible:size-10 md:focus-visible:size-8"
        >
          <ChevronDown className="size-4" />
        </PopoverTrigger>
      </span>
      <PopoverContent
        side="top"
        align="start"
        anchor={anchor}
        aria-label="Choose a reaction"
        initialFocus={() => viaTrigger.current}
        finalFocus={() => (viaTrigger.current ? button.current : false)}
        className="w-auto flex-row gap-0 rounded-full p-1"
        {...hover}
      >
        {types.map((type) => (
          <button
            key={type.id}
            type="button"
            title={type.label}
            aria-label={type.label}
            aria-pressed={type.id === current}
            onClick={() => choose(type.id === current ? null : type.id)}
            className="flex size-10 select-none items-center justify-center rounded-full text-xl leading-none transition-transform hover:scale-125 focus-visible:scale-125 aria-pressed:bg-muted"
          >
            {type.emoji}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
