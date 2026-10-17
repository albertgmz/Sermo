"use client";

// The browser moves the focus to the target when it follows the link, but another script on the
// page can cancel that (the developer page's API browser takes over every in-page link for its own
// scrolling), so the link moves it as well. The address stays for a page without script.
export function skipTo(id: string) {
  document.getElementById(id)?.focus();
}

// Out of sight above the window until it holds the focus.
export function SkipLinkAnchor({
  target,
  children,
}: {
  target: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={`#${target}`}
      onClick={() => skipTo(target)}
      className="fixed top-2 left-2 z-50 inline-flex h-10 -translate-y-20 items-center rounded-md border bg-popover px-4 text-sm font-medium text-popover-foreground shadow-lg focus:translate-y-0"
    >
      {children}
    </a>
  );
}
