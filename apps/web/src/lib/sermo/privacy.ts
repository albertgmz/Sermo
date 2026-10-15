import "server-only";

import { privacyLogRetention } from "@sermo/core/contracts";
import { cacheLife } from "next/cache";
import { callWith } from "./transport";

// How many days the backend keeps its log of addresses, devices and places. The same for every
// visitor, so it is asked without their cookies or address and shared, like the site identity.
// Null when the backend cannot say: the pages then leave the number out. A failure is answered
// here (an error thrown out of a cached function fails the prerender) and asked again soon.
export async function getLogRetentionDays(): Promise<number | null> {
  "use cache";
  try {
    const { days } = await callWith({}, privacyLogRetention, {});
    cacheLife({ stale: 300, revalidate: 300, expire: 3600 });
    return days;
  } catch {
    cacheLife({ stale: 30, revalidate: 5, expire: 600 });
    return null;
  }
}
