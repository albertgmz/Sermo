"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { hashLinkTarget } from "@/components/layout/hash-link-target";
import { HASH_LINK_EVENT, TARGET } from "@/components/layout/spotlight";

// A link to a place on the page being read (`#reply`, the number of a post). Next's `Link` appends
// the hash to the address the page was first loaded with, so on a page opened with `#post-45` a
// link to `#post-43` becomes `#post-45#post-43`. A link that stays on the page changes the address
// through `history.pushState` instead (the router follows it, so a later refresh keeps it) and the
// query stays as it is; the dimming around a post starts from the event below (`HashTarget`). A
// link to another page of the thread is an ordinary navigation to its address.
export function HashLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <Link
      href={href}
      className={className}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        const to = hashLinkTarget({
          href,
          here: window.location,
          hasElement: (id) => document.getElementById(id) !== null,
        });
        event.preventDefault();
        if (!to.samePage) {
          router.push(to.url);
          return;
        }
        if (to.hash !== window.location.hash) {
          window.history.pushState(null, "", to.url);
        }
        if (TARGET.test(to.hash)) {
          window.dispatchEvent(
            new CustomEvent(HASH_LINK_EVENT, { detail: to.hash }),
          );
        } else {
          document.getElementById(to.hash.slice(1))?.scrollIntoView();
        }
      }}
    >
      {children}
    </Link>
  );
}
