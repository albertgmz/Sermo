import { authMe } from "@sermo/core/contracts";
import { isSignedOut, SermoError } from "./errors";
import { callWith, forwardFromHeaders } from "./transport";

// What the backend says about the visitor; null for a dead cookie or a banned account.
export async function viewerOf(headers: Headers) {
  try {
    return await callWith(forwardFromHeaders(headers), authMe, {});
  } catch (error) {
    if (error instanceof SermoError && isSignedOut(error)) {
      return null;
    }
    throw error;
  }
}
