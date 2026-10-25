"use client";

import Link from "next/link";
import { isPlainClick } from "@/components/ui/lazy-popup-intent";
import {
  askToJoin,
  type JoinReason,
  loginHref,
  warmJoinWindow,
} from "@/lib/join-window";
import { cn } from "@/lib/utils";

// An action only members can take, as a guest sees it: a link to the log-in page (coming back to
// `next`) that a plain press turns into the sign-up window (`lib/join-window.ts`) once the page
// holds it. A modified press (a new tab) still follows the link. While the window's code is on its
// way the link says it is busy.
export function JoinLink({
  reason,
  next,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Link>, "href" | "onClick"> & {
  reason: JoinReason;
  next: string;
}) {
  return (
    <Link
      {...props}
      href={loginHref(next)}
      data-join=""
      className={cn(className, "aria-busy:cursor-progress")}
      onPointerEnter={warmJoinWindow}
      onTouchStart={warmJoinWindow}
      onFocus={warmJoinWindow}
      onClick={(event) => {
        const link = event.currentTarget;
        const busy = (waiting: boolean) => {
          if (waiting) link.setAttribute("aria-busy", "true");
          else link.removeAttribute("aria-busy");
        };
        if (isPlainClick(event) && askToJoin({ reason, next }, busy))
          event.preventDefault();
      }}
    />
  );
}
