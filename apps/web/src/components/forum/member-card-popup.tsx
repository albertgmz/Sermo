"use client";

import { useTranslations } from "next-intl";
import {
  Suspense,
  startTransition,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { loadMemberCard } from "@/components/forum/member-card-action";
import { settledCard } from "@/components/forum/member-card-intent";
import { MemberCardProfileLink } from "@/components/forum/member-card-profile-link";
import {
  MemberCardClose,
  MemberCardReload,
} from "@/components/forum/member-card-scope";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

// What a trigger and the mention delegate share: reading the card and the frame it is drawn in.
// From `md` up the card is a popover beside what was clicked, below it a sheet from the bottom.
const DESKTOP = "(min-width: 48rem)";
// One query for every trigger on the page, made on first use.
let desktopQuery: MediaQueryList | undefined;
const desktop = () => {
  desktopQuery ??= matchMedia(DESKTOP);
  return desktopQuery;
};
const subscribeDesktop = (notify: () => void) => {
  desktop().addEventListener("change", notify);
  return () => desktop().removeEventListener("change", notify);
};
const useDesktop = () =>
  useSyncExternalStore(
    subscribeDesktop,
    () => desktop().matches,
    () => true,
  );

export function useMemberCard(id: number, name: string) {
  // undefined until the first open has loaded it, null for an unknown member
  const [card, setCard] = useState<React.ReactNode>();
  const latest = useRef(0);
  const fallback = useMemo(
    () => <MemberCardFallback id={id} name={name} />,
    [id, name],
  );

  // Reads the card, on every open and after a write made inside it. What is shown stays until the
  // new one arrives, so a follow made elsewhere on the page shows the next time; only the last
  // read is kept.
  const load = useCallback(() => {
    const mine = ++latest.current;
    startTransition(async () => {
      try {
        const next = await loadMemberCard(id, name);
        // The transition does not reach past the await: the update is made one again, so the
        // card (whose client parts may still be loading) never takes the page into a fallback.
        if (mine === latest.current)
          startTransition(() =>
            setCard((previous) => settledCard(previous, next, fallback)),
          );
      } catch {
        // the card keeps showing what it had, or the name and the way to the profile
        if (mine === latest.current)
          setCard((previous) => settledCard(previous, null, fallback));
      }
    });
  }, [id, name, fallback]);

  return { card, load };
}

// What the card shows when the member could not be read: the name and the way to the profile.
function MemberCardFallback({ id, name }: { id: number; name: string }) {
  return (
    <div className="flex flex-col items-stretch gap-3 p-4 text-center">
      <p className="text-sm font-semibold [overflow-wrap:anywhere]">{name}</p>
      <MemberCardProfileLink id={id} />
    </div>
  );
}

export function MemberCardPopup({
  name,
  card,
  reload,
  ...props
}: Omit<React.ComponentProps<typeof PopoverContent>, "children"> & {
  name: string;
  card: React.ReactNode;
  reload: () => void;
}) {
  const t = useTranslations("forum.memberCardTrigger");
  return (
    <PopoverContent
      aria-label={t("aria.label", { name })}
      className="relative isolate max-h-(--available-height) w-96 max-w-[calc(100vw-2rem)] overflow-y-auto p-0"
      {...props}
    >
      <CardBody card={card} reload={reload} />
    </PopoverContent>
  );
}

// What a popover or a sheet says about why it asks to change state.
type CloseDetails = { reason: string; event: Event };

// The card in its frame: a popover anchored to the `trigger` (or to `anchor`) on a wide screen, a
// bottom sheet on a phone, with the same content. Focus moves into it on open and returns to
// where it was on close. Both are the positioned box the postbit's cover is drawn against (the
// sheet is fixed).
export function MemberCardSurface({
  open,
  onOpenChange,
  name,
  card,
  reload,
  trigger,
  anchor,
  finalFocus,
  popupRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean, details: CloseDetails) => void;
  name: string;
  card: React.ReactNode;
  reload: () => void;
  trigger?: React.ReactNode;
  anchor?: Element;
  finalFocus?: React.ComponentProps<typeof PopoverContent>["finalFocus"];
  popupRef?: React.Ref<HTMLDivElement>;
}) {
  const t = useTranslations("forum.memberCardTrigger");
  const wide = useDesktop();
  return (
    <MemberCardClose
      value={() =>
        onOpenChange(false, {
          reason: "close-press",
          event: new Event("click"),
        })
      }
    >
      <Popover open={open && wide} onOpenChange={onOpenChange}>
        {trigger}
        <MemberCardPopup
          ref={popupRef}
          name={name}
          card={card}
          reload={reload}
          anchor={anchor}
          align="start"
          finalFocus={finalFocus}
        />
      </Popover>
      <Sheet open={open && !wide} onOpenChange={onOpenChange}>
        <SheetContent
          ref={popupRef}
          side="bottom"
          finalFocus={finalFocus}
          className="max-h-[85dvh] overflow-y-auto p-0 pt-10 pb-[env(safe-area-inset-bottom)]"
        >
          <SheetTitle className="sr-only">
            {t("aria.label", { name })}
          </SheetTitle>
          <CardBody card={card} reload={reload} />
        </SheetContent>
      </Sheet>
    </MemberCardClose>
  );
}

export const CardSkeleton = () => (
  <div className="p-3">
    <Skeleton className="h-48 w-full" />
  </div>
);

// The loaded card, or its skeleton before the first read. The card can suspend (its client parts
// load lazily); inside a portal a suspend reaches the nearest boundary of the trigger in the
// React tree, which is the page's own list and would be hidden for a fallback. Its own boundary
// keeps that inside the card.
export function CardBody({
  card,
  reload,
}: {
  card: React.ReactNode;
  reload: () => void;
}) {
  if (card === undefined) return <CardSkeleton />;
  return (
    <Suspense fallback={<CardSkeleton />}>
      <MemberCardReload value={reload}>{card}</MemberCardReload>
    </Suspense>
  );
}
