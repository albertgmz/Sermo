"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// The guests' forms (and the Cloudflare widget's code) are for guests in a forum that lets them
// post; a member's page load does not carry them.
export const LazyGuestReplyForm = dynamic(
  () =>
    import("@/components/forum/guest-reply-form").then(
      (module) => module.GuestReplyForm,
    ),
  { loading: () => <Skeleton className="h-48 w-full" /> },
);

export const LazyGuestThreadComposer = dynamic(
  () =>
    import("@/components/forum/guest-thread-composer").then(
      (module) => module.GuestThreadComposer,
    ),
  { loading: () => <Skeleton className="h-96 w-full" /> },
);
