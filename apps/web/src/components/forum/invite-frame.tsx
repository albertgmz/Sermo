"use client";

import { useEffect, useRef } from "react";
import { inviteOnScreen } from "@/lib/invites-in-view";

// The box of an invitation drawn in the page, which says while it is on the screen
// (`lib/invites-in-view.ts`).
export function InviteFrame(props: React.ComponentProps<"section">) {
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = box.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    let leave: (() => void) | null = null;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) leave ??= inviteOnScreen();
      else {
        leave?.();
        leave = null;
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      leave?.();
    };
  }, []);
  return <section ref={box} data-signup-invite="" {...props} />;
}
