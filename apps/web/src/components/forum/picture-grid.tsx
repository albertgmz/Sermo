"use client";

import Link from "next/link";
import { type ReactNode, useEffect } from "react";
import type { PictureRef } from "@/components/forum/picture-ref";
import type { PictureEntry } from "@/components/forum/picture-types";
import { usePictureViewer } from "@/components/forum/picture-viewer";
import { cn } from "@/lib/utils";

// The cards of one page of pictures. Large cards: one column on a phone, two from a small tablet,
// three on a desktop; every card has its own fixed box (see `PictureCard`), so the grid has its
// height before a picture loads. The page tells the viewer which pictures it holds.
export function PictureGrid({
  entries,
  children,
}: {
  entries: PictureEntry[];
  children: ReactNode;
}) {
  const viewer = usePictureViewer();
  useEffect(() => viewer?.register(entries), [viewer, entries]);
  return (
    <ul className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
      {children}
    </ul>
  );
}

// A card's picture: a link to where the picture is that opens the viewer instead when scripts run
// (a click with a modifier, or a middle click, is still the link's). The box keeps one proportion
// whatever the picture; `children` is the thumbnail, drawn on the server through the LITE gate.
export function PictureCard({
  picture,
  href,
  label,
  className,
  children,
}: {
  picture: PictureRef;
  href: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const viewer = usePictureViewer();
  return (
    <Link
      href={href}
      prefetch={false}
      aria-label={label}
      className={cn(
        "relative block aspect-4/3 overflow-hidden bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        className,
      )}
      onClick={(event) => {
        if (!viewer || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        viewer.open(picture);
      }}
    >
      {children}
    </Link>
  );
}
