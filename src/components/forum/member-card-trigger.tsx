"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function MemberCardTrigger({
  href,
  name,
  className,
  card,
  children,
}: {
  href: string;
  name: string;
  className?: string;
  card: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement>(null);
  const pointerType = useRef("");
  const restoringFocus = useRef(false);
  const returnFocus = useRef(false);

  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        returnFocus.current = details.reason === "escape-key";
        setOpen(next);
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
          "inline-block min-h-10 min-w-10 max-w-full content-center align-middle rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          className,
        )}
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
            setOpen(true);
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
        aria-label={`${name}'s member card`}
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
        {card}
      </PopoverContent>
    </Popover>
  );
}
