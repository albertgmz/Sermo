"use client";

import { useEffect } from "react";
import { readCounters } from "@/components/layout/counters-action";
import {
  onCountersAsked,
  publishCounters,
  rememberDrawn,
} from "@/lib/counters";
import { POLL_MS } from "@/lib/poll-intervals";
import { usePolling } from "@/lib/polling";

// Reads the unread counts of a signed-in member now and then, so the badges follow messages and
// alerts that arrive while a page is open, and at once when the page says a count changed. Draws
// nothing. `drawn` is what the page drew them as.
export function CountersPoll({
  drawn,
}: {
  drawn: { conversations: number; notifications: number };
}) {
  useEffect(() => {
    rememberDrawn(drawn);
  }, [drawn]);
  usePolling(
    async () => {
      const found = await readCounters();
      if ("stop" in found) return "stop";
      publishCounters(drawn, found);
    },
    { intervalMs: POLL_MS.counters },
  );
  // Read again at once when the page changed a count (`countersChanged`).
  useEffect(
    () =>
      onCountersAsked(() => {
        void readCounters().then((found) => {
          if (!("stop" in found)) publishCounters(drawn, found);
        });
      }),
    [drawn],
  );
  return null;
}
