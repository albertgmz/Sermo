"use client";

import { usePathname } from "next/navigation";
import { currentOf } from "./navigation";
import type { NavSection } from "./navigation-data";

// The title of the section the address belongs to, in the top bar.
export function SectionTitle({ sections }: { sections: NavSection[] }) {
  const current = currentOf(usePathname(), sections);
  return (
    <p className="min-w-0 flex-1 truncate border-l pl-3 text-sm font-semibold">
      {current?.section.label}
    </p>
  );
}
