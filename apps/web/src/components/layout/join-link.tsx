"use client";

import Link from "next/link";
import { isPlainClick } from "@/components/ui/lazy-popup-intent";
import {
  askToJoin,
  type JoinReason,
  loginHref,
  warmJoinWindow,
} from "@/lib/join-window";

// An action only members can take, as a guest sees it: a link to the log-in page (coming back to
// `next`) that a plain press turns into the sign-up window (`lib/join-window.ts`) once the page
// holds it. A modified press (a new tab) still follows the link.
export function JoinLink({
  reason,
  next,
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
      onPointerEnter={warmJoinWindow}
      onTouchStart={warmJoinWindow}
      onFocus={warmJoinWindow}
      onClick={(event) => {
        if (isPlainClick(event) && askToJoin({ reason, next }))
          event.preventDefault();
      }}
    />
  );
}
