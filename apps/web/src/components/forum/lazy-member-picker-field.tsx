"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// The member picker for a place that is not the page's own content (the search popup in the
// header): its code is asked for when the popup draws it, so it is no part of any page's first
// load.
export const LazyMemberPickerField = dynamic(
  () =>
    import("@/components/forum/member-picker-field").then(
      (module) => module.MemberPickerField,
    ),
  { loading: () => <Skeleton className="h-10 w-full" /> },
);
