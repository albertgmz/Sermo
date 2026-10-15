import { SermoError } from "@/lib/sermo/errors";

// What the backend says when there is nothing left to poll: the session ended, or the record is
// gone or no longer the visitor's to read.
const ENDS_POLLING = ["not_found", "unauthenticated", "forbidden"];

export type PollStop = { stop: true };

// A poll asked for by an action: a session that ended or a record that went away stops polling
// (the screen is not turned into a sign-in page or a 404 in the middle of reading, and a reload
// says what is the matter). Any other failure (the backend down, a rate limit) is raised, and the
// poll backs off.
export async function pollQuietly<T>(
  run: () => Promise<T>,
): Promise<T | PollStop> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof SermoError && ENDS_POLLING.includes(error.code)) {
      return { stop: true };
    }
    throw error;
  }
}
