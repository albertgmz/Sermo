"use client";

import { useTranslations } from "next-intl";
import { startTransition, useCallback, useRef, useState } from "react";
import { loadMemberCard } from "@/components/forum/member-card-action";
import { MemberCardReload } from "@/components/forum/member-card-scope";
import { PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";

// What a trigger and the mention delegate share: reading the card once, on the first open, and the
// frame it is drawn in.
export const CARD_DELAY = 300;
export const CARD_CLOSE_DELAY = 150;

export function useMemberCard(id: number, name: string) {
  // undefined until the first open has loaded it, null for an unknown member
  const [card, setCard] = useState<React.ReactNode>();
  const requested = useRef(false);

  const load = useCallback(() => {
    if (requested.current) return;
    requested.current = true;
    startTransition(async () => {
      try {
        setCard(await loadMemberCard(id, name));
      } catch {
        requested.current = false;
      }
    });
  }, [id, name]);

  // After a write made inside the card: read it again, keeping what is shown until it arrives.
  const reload = useCallback(() => {
    startTransition(async () => {
      try {
        setCard(await loadMemberCard(id, name));
      } catch {
        // the card keeps showing what it had
      }
    });
  }, [id, name]);

  return { card, load, reload };
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
      {card === undefined ? (
        <Skeleton className="h-56 w-full" />
      ) : (
        <MemberCardReload value={reload}>{card}</MemberCardReload>
      )}
    </PopoverContent>
  );
}
