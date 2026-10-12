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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ReactionType } from "@/lib/types";
import { cn } from "@/lib/utils";

const HOVER_OPEN_MS = 350;
const HOVER_CLOSE_MS = 250;
const LONG_PRESS_MS = 450;
// How long the backend's refusal stays under the button.
const REFUSAL_MS = 6000;

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
  const anchor = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const touch = useRef(false);
  const longPressed = useRef(false);
  const viaTrigger = useRef(false);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!refusal) return;
    const hide = setTimeout(() => setRefusal(undefined), REFUSAL_MS);
    return () => clearTimeout(hide);
  }, [refusal]);

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
          aria-label={t("aria.state", {
            label: (active ?? types[0]).label,
            count,
          })}
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
        side="top"
        align="start"
        anchor={anchor}
        aria-label={t("aria.choose")}
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
