"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { useTabSwitch } from "@/components/forum/tab-switch-context";

// A link of a tab bar. Inside a `TabSwitch` that is bringing another tab in, the tab pressed is the
// open one at once, while its panel is still on its way; elsewhere it is the server's `current`.
export function TabAnchor({
  href,
  current,
  ...props
}: Omit<ComponentProps<typeof Link>, "href" | "aria-current"> & {
  href: string;
  current: boolean;
}) {
  const switching = useTabSwitch();
  const pending = switching?.pending ?? null;
  const open =
    pending === null
      ? current
      : switching?.placeOf(new URL(href, "http://tab.invalid").search) ===
        pending;
  return (
    <Link href={href} aria-current={open ? "page" : undefined} {...props} />
  );
}
