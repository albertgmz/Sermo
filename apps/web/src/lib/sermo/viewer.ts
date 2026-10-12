import { authMe } from "@sermo/core/contracts";
import { SermoError } from "./errors";
import { callWith, forwardFromHeaders } from "./transport";

// The signed-in account as the backend sees it; null for a guest or a dead cookie.
export async function viewerOf(headers: Headers) {
  try {
    return await callWith(forwardFromHeaders(headers), authMe, {});
  } catch (error) {
    if (error instanceof SermoError && error.code === "unauthenticated") {
      return null;
    }
    throw error;
  }
}
