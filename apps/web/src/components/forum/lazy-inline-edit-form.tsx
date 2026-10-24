"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// The edit form's code comes when Edit is pressed, not with the page: a feed or a wall of cards
// does not carry the editor around an item's source. The placeholder is the one the form itself
// draws while it asks for the source.
export const LazyInlineEditForm = dynamic(
  () =>
    import("@/components/forum/inline-edit-form").then(
      (module) => module.InlineEditForm,
    ),
  { ssr: false, loading: () => <Skeleton className="h-10 w-full" /> },
);
