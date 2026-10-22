"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

export type ForumOption = { id: number; title: string; depth: number };

// A choice among the forums the backend lists; the chosen forum's id is submitted under `name`.
// It is drawn inside a confirm step that opens on a press, and the select's code is asked for
// then, so it is no part of the page's first load.
export const ForumPicker = dynamic(
  () =>
    import("@/components/forum/forum-picker-field").then(
      (module) => module.ForumPickerField,
    ),
  { loading: () => <Skeleton className="h-10 w-full" /> },
);
