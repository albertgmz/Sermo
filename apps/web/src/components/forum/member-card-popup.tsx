"use client";

import { useTranslations } from "next-intl";
import {
  Suspense,
  startTransition,
  useCallback,
  useRef,
  useState,
} from "react";
import { loadMemberCard } from "@/components/forum/member-card-action";
import { MemberCardReload } from "@/components/forum/member-card-scope";
import { PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";

// What a trigger and the mention delegate share: reading the card and the frame it is drawn in.
export const CARD_DELAY = 300;
export const CARD_CLOSE_DELAY = 150;

export function useMemberCard(id: number, name: string) {
  // undefined until the first open has loaded it, null for an unknown member
  const [card, setCard] = useState<React.ReactNode>();
  const latest = useRef(0);

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
        if (mine === latest.current) startTransition(() => setCard(next));
      } catch {
        // the card keeps showing what it had
      }
    });
  }, [id, name]);

  return { card, load };
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
      className="max-h-(--available-height) w-56 max-w-[calc(100vw-2rem)] overflow-y-auto p-3"
      {...props}
    >
      <CardBody card={card} reload={reload} />
    </PopoverContent>
  );
}

export const CardSkeleton = () => <Skeleton className="h-56 w-full" />;

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
