"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { startTransition, useRef, useState, useSyncExternalStore } from "react";
import { loadMemberCard } from "@/components/forum/member-card-action";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { getCommittedLiteValue, subscribeLiteValue } from "@/lib/lite-sync";
import { cn } from "@/lib/utils";

export function MemberCardTrigger(
  props: React.ComponentProps<typeof MemberCardWithPreference>,
) {
  const preference = useSyncExternalStore(
    subscribeLiteValue,
    getCommittedLiteValue,
    () => "",
  );
  return <MemberCardWithPreference key={preference} {...props} />;
}

function MemberCardWithPreference({
  id,
  href,
  name,
  className,
  style,
  children,
}: {
  id: number;
  href: string;
  name: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const t = useTranslations("forum.memberCardTrigger");
  const [open, setOpen] = useState(false);
  // undefined until the first open has loaded it, null for an unknown member
  const [card, setCard] = useState<React.ReactNode>();
  const requested = useRef(false);
  const trigger = useRef<HTMLElement>(null);
  const pointerType = useRef("");
  const restoringFocus = useRef(false);
  const returnFocus = useRef(false);

  function show() {
    setOpen(true);
    if (requested.current) return;
    requested.current = true;
    startTransition(async () => {
      try {
        setCard(await loadMemberCard(id));
      } catch {
        requested.current = false;
      }
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        returnFocus.current = details.reason === "escape-key";
        if (next) show();
        else setOpen(false);
      }}
    >
      <PopoverTrigger
        ref={(element) => {
          trigger.current = element;
        }}
        nativeButton={false}
        role="link"
        openOnHover
        delay={300}
        closeDelay={150}
        render={<Link href={href} />}
        className={cn(
          "relative rounded-sm after:absolute after:-inset-x-1 after:-inset-y-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          className,
        )}
        style={style}
        onPointerDown={(event) => {
          pointerType.current = event.pointerType;
        }}
        onKeyDown={() => {
          pointerType.current = "";
        }}
        onFocus={(event) => {
          if (restoringFocus.current) {
            restoringFocus.current = false;
          } else if (event.currentTarget.matches(":focus-visible")) {
            show();
          }
        }}
        onClick={(event) => {
          if (
            pointerType.current === "touch" ||
            pointerType.current === "pen"
          ) {
            event.preventDefault();
          } else {
            event.preventBaseUIHandler();
          }
        }}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        aria-label={t("aria.label", { name })}
        align="start"
        className="max-h-(--available-height) w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-0"
        initialFocus={(type) => type === "touch" || type === "pen"}
        finalFocus={() => {
          if (
            returnFocus.current &&
            document.activeElement !== trigger.current
          ) {
            restoringFocus.current = true;
            return trigger.current;
          }
          return false;
        }}
      >
        {card === undefined ? (
          <Skeleton className="h-56 w-full rounded-none" />
        ) : (
          card
        )}
      </PopoverContent>
    </Popover>
  );
}
