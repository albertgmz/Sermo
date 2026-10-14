"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { markOneRead } from "@/app/[locale]/(main)/notifications/actions";

// Whether an address leads off this site once a browser has read it (`/\evil.com` is a host to
// a browser). Judged against a fixed base, so the server and the browser agree.
function leavesSite(href: string) {
  const base = "http://site.invalid";
  try {
    return new URL(href, base).origin !== base;
  } catch {
    return true;
  }
}

// The link of a notification row: following it marks the notification read. The unread counts are
// drawn by the layout, which a soft navigation does not render again, so the route is refreshed
// once the answer is in. A thread page is not: rendering it again would count another view. An
// address outside the site (an alert with a link) opens in a new tab.
export function NotificationLink({
  id,
  href,
  read,
  className,
  children,
}: {
  id: number;
  href: string;
  read: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const markRead = () => {
    if (read) return;
    void markOneRead(id).then(() => {
      if (!window.location.pathname.startsWith("/threads/")) {
        router.refresh();
      }
    });
  };
  if (leavesSite(href)) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        onClick={markRead}
      >
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} onClick={markRead}>
      {children}
    </Link>
  );
}
