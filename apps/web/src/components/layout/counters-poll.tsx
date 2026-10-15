"use client";

import { readCounters } from "@/components/layout/counters-action";
import { publishCounters } from "@/lib/counters";
import { POLL_MS } from "@/lib/poll-intervals";
import { usePolling } from "@/lib/polling";

// Reads the unread counts of a signed-in member now and then, so the badges follow messages and
// alerts that arrive while a page is open. Draws nothing. `drawn` is what the page drew them as.
export function CountersPoll({
  drawn,
}: {
  drawn: { conversations: number; notifications: number };
}) {
  usePolling(
    async () => {
      const found = await readCounters();
      if ("stop" in found) return "stop";
      publishCounters(drawn, found);
    },
    { intervalMs: POLL_MS.counters },
  );
  return null;
}
