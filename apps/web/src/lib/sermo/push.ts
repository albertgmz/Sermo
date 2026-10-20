import "server-only";

import { pushPublicKey } from "@sermo/core/contracts";
import { cacheLife } from "next/cache";
import { callWith } from "./transport";

// The forum's push key (`push.publicKey`), null when the forum has none. It is public and the same
// for everyone, so it is shared like the site's settings and asked without cookies; the layout
// reads it on every page to decide whether to offer notifications. It changes only with the
// server's configuration, which restarts the backend. A failure reads as "no push" for a moment.
export async function getPushKey(): Promise<string | null> {
  "use cache";
  try {
    const { publicKey } = await callWith({}, pushPublicKey, {});
    cacheLife({ stale: 300, revalidate: 300, expire: 3600 });
    return publicKey;
  } catch (error) {
    cacheLife({ stale: 30, revalidate: 5, expire: 600 });
    if (process.env.NEXT_PHASE !== "phase-production-build")
      console.error("The push key could not be read from the API", error);
    return null;
  }
}
