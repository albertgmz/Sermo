"use client";

import Link from "next/link";

// The number of a post: a link to the post at its own address. Next's `Link` appends the hash to
// the address the page was first loaded with, so on a page opened with `#post-45` a bare
// `#post-43` becomes `#post-45#post-43`. When the link stays on the page being read, the address
// is changed through `history.pushState` instead (the router follows it, so a later refresh
// keeps it); the dimming around the post, and the scroll to it, start from the click (`HashTarget`), as for
// any link to the same page.
// Another page of the thread is an ordinary soft navigation.
export function PostPermalink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
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
        const to = new URL(href, window.location.href);
        const here = window.location;
        if (to.pathname !== here.pathname || to.search !== here.search) return;
        event.preventDefault();
        if (to.hash === here.hash) return;
        window.history.pushState(
          null,
          "",
          `${to.pathname}${to.search}${to.hash}`,
        );
      }}
    >
      {children}
    </Link>
  );
}
