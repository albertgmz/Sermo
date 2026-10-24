"use client";

import { ChevronDown, Heart } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ComponentType, useEffect, useRef, useState } from "react";
import {
  actionLabelClass,
  messageActionClass,
} from "@/components/forum/message-action";
import type { ReactionPickerProps } from "@/components/forum/reaction-picker";
import {
  ReactionPicture,
  type ReactionPictureData,
} from "@/components/forum/reaction-picture";
import {
  type PickerGrid,
  type PickerPlacement,
  pickerBox,
  placePicker,
} from "@/components/forum/reaction-placement";
import { useReactionGesture } from "@/components/forum/use-reaction-gesture";
import {
  createOpener,
  type Loader,
  loadedCode,
} from "@/components/ui/lazy-popup-gate";
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

// The picker is rows of square reactions, centred, two even rows while they fit (`pickerGrid`);
// its width never outgrows the viewport.
export const PICKER_CLASS =
  "w-auto max-w-[calc(100vw-2rem)] flex-col items-center gap-0 rounded-3xl p-1";

// The reactions' size from `pickerGrid`: each reaction is `--cell` square. The picture is 1.25em
// of the font size, about two thirds of its square: 35px in a 52px reaction, 27px in a 40px one.
export function pickerStyle({ cell }: PickerGrid) {
  return {
    "--cell": `${cell}px`,
    fontSize: `${Math.round(cell * 0.54)}px`,
  } as React.CSSProperties;
}

// The reactions cut into the rows of `pickerGrid`, in order.
export function pickerRows<T>(items: T[], rows: number[]): T[][] {
  return rows.map((length, index) => {
    const start = rows.slice(0, index).reduce((sum, row) => sum + row, 0);
    return items.slice(start, start + length);
  });
}

// Where the picker goes for the button as it is on screen now, or nothing when it is not drawn.
function placementNow(anchor: HTMLElement | null, count: number) {
  const rect = anchor?.getBoundingClientRect();
  return (
    rect &&
    placePicker({
      anchor: rect,
      count,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    })
  );
}

// The picker's trigger for the keyboard, the same plain or real: hidden until it has focus.
export const PICKER_TRIGGER_CLASS =
  "sr-only inline-flex items-center justify-center rounded-md text-muted-foreground focus-visible:not-sr-only focus-visible:size-10 md:focus-visible:size-8";

// The picker's code (Base UI's popover and the positioning library with it) is not part of the
// page's first load. `handlers` fetch it when the button is first reached for (the pointer coming
// over it, a touch, focus on it or on the picker's trigger), so the hover delay or the hold hides
// the fetch. `show` opens or closes the picker: asked for, it is handed to `arrived` once its code
// is there and it is still wanted. A fetch that fails twice closes it, and from then on only an
// opening fetches again, so a pointer sweeping a list of buttons offline asks for nothing.
export function createPickerControl<C>(
  load: Loader<C>,
  view: { arrived: (picker: C) => void; setOpen: (open: boolean) => void },
) {
  let asked = false;
  let failed = false;
  let arrived = false;
  const opener = createOpener(load, {
    slot: "reaction",
    show: () => {
      arrived = true;
      view.arrived(loadedCode(load) as C);
    },
    // A wish that ends without the picker arriving (another button's opening took its place, or
    // the fetch failed) leaves it closed, so the next press opens it again. The code's arrival
    // ends the wish just before handing it over: wait for that first.
    busy: (waiting) => {
      if (waiting) return;
      queueMicrotask(() => {
        if (!asked || arrived || opener.pending) return;
        asked = false;
        view.setOpen(false);
      });
    },
    fail: () => {
      failed = true;
    },
  });
  const warm = () => {
    if (!failed) opener.warm();
  };
  return {
    handlers: { onPointerEnter: warm, onTouchStart: warm, onFocus: warm },
    show(next: boolean) {
      asked = next;
      if (next) {
        failed = false;
        opener.open();
      } else opener.cancel();
      view.setOpen(next);
    },
    // The picker is open or on its way: while it is not drawn yet, a slide toward it waits for it.
    asked: () => asked,
  };
}

const loadPicker = () => import("@/components/forum/reaction-picker");

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
  // The picker, once it was asked for and its code is there; a plain trigger until then.
  const [Picker, setPicker] = useState<ComponentType<ReactionPickerProps>>();
  const [control] = useState(() =>
    createPickerControl(loadPicker, {
      arrived: (code) => setPicker(() => code),
      setOpen,
    }),
  );
  const [placement, setPlacement] = useState<PickerPlacement>();
  const anchor = useRef<HTMLSpanElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const viaTrigger = useRef(false);
  // Where the picker last asked for goes, for the gesture while it is not drawn yet.
  const expected = useRef<PickerPlacement>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);
  // A button drawn away while its picker's code is on its way wants it no more.
  useEffect(() => () => control.show(false), [control]);

  useEffect(() => {
    if (!refusal) return;
    const hide = setTimeout(() => setRefusal(undefined), REFUSAL_MS);
    return () => clearTimeout(hide);
  }, [refusal]);

  // The picker is laid out for the window's width when it opens; when the width changes while it
  // is open (a phone turned, a window resized) it is laid out again. A height change alone (a
  // phone's address bar) leaves it as it is.
  useEffect(() => {
    if (!open) return;
    let width = window.innerWidth;
    const relayout = () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      const next = placementNow(anchor.current, types.length);
      if (next) setPlacement(next);
    };
    window.addEventListener("resize", relayout);
    return () => window.removeEventListener("resize", relayout);
  }, [open, types.length]);

  const gesture = useReactionGesture({
    picker,
    pickerExpected: () => {
      const rect = anchor.current?.getBoundingClientRect();
      return control.asked() && rect && expected.current
        ? pickerBox(rect, expected.current)
        : undefined;
    },
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
  // What a press gives, as XenForo's button says it: the viewer's own reaction, or the first one
  // they may give. The number is the summary's.
  const named = active ?? first ?? types[0];
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
      {named && <span className={actionLabelClass}>{named.label}</span>}
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
    const placed = next && placementNow(anchor.current, types.length);
    if (placed) {
      setPlacement(placed);
      expected.current = placed;
    }
    control.show(next);
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
    <span
      ref={anchor}
      className={cn("inline-flex items-center", className)}
      {...hover}
    >
      <button
        ref={gesture.buttonRef}
        type="button"
        aria-pressed={current !== null}
        aria-label={t("aria.state", { label: named.label, count })}
        className={buttonClass}
        {...control.handlers}
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
      {Picker ? (
        <Picker
          open={open}
          onOpenChange={(next, details) => {
            const pressedAnchor =
              details.reason === "outside-press" &&
              anchor.current?.contains(details.event.target as Node);
            if (pressedAnchor) return;
            if (next) viaTrigger.current = details.reason === "trigger-press";
            show(next);
          }}
          anchor={anchor}
          picker={picker}
          placement={placement}
          types={types}
          current={current}
          hovered={gesture.hover}
          hover={hover}
          viaTrigger={viaTrigger}
          button={gesture.button}
          choose={choose}
        />
      ) : (
        // The picker's trigger until its code is asked for, the same as far as the page can tell.
        // A second press while the code is on its way withdraws the wish.
        <button
          type="button"
          data-slot="popover-trigger"
          aria-haspopup="dialog"
          aria-expanded="false"
          aria-label={t("aria.choose")}
          className={PICKER_TRIGGER_CLASS}
          {...control.handlers}
          onClick={() => {
            viaTrigger.current = true;
            show(!open);
          }}
        >
          <ChevronDown className="size-4" />
        </button>
      )}
      {refusal && (
        <span role="alert" className="ml-1 text-xs text-destructive">
          {refusal}
        </span>
      )}
    </span>
  );
}
