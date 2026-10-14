"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { markOneRead } from "@/app/[locale]/(main)/notifications/actions";

// The link of a notification row: following it marks the notification read. The unread counts are
// drawn by the layout, which a soft navigation does not render again, so the route is refreshed
// once the answer is in. A thread page is not: rendering it again would count another view.
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
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        if (read) return;
        void markOneRead(id).then(() => {
          if (!window.location.pathname.startsWith("/threads/")) {
            router.refresh();
          }
        });
      }}
    >
      {children}
    </Link>
  );
}
