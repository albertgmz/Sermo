"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// The poll block is code for threads that have a poll only: it is asked for when one is drawn, so
// the first load of every other thread page does not carry it.
export const LazyPoll = dynamic(
  () =>
    import("@/components/forum/poll-block").then((module) => module.PollBlock),
  { loading: () => <Skeleton className="mt-4 h-48 w-full" /> },
);
