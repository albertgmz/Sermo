import "server-only";

import { SermoError } from "@/lib/sermo/errors";

// A block of the panel asks for what the backend may refuse this member (it reports only what
// they may read). A refusal leaves the block out; any other failure is the page's to show.
export async function orNothing<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof SermoError &&
      (error.code === "not_found" || error.code === "forbidden")
    ) {
      return null;
    }
    throw error;
  }
}
