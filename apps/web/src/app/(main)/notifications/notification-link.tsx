"use client";

import Link from "next/link";
import { markOneRead } from "@/app/(main)/notifications/actions";

// The link of a notification row: following it marks the notification read.
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
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        if (!read) void markOneRead(id);
      }}
    >
      {children}
    </Link>
  );
}
