import "server-only";

import { cache } from "react";
import { sessionUnconfirmed, viewerOfRequest } from "./client";
import { SermoError } from "./errors";

// The visitor as the backend sees them. A dead cookie or a banned account is a guest; nothing is
// written here. When the backend could not say who is asking, this is a guest too, so the shell
// can be drawn (`sessionUnconfirmed` says which).
export const getViewer = cache(viewerOfRequest);

// For what only a member can open or do: with the session unconfirmed there is no telling a
// member from a guest, and sending them to sign in would be wrong, so the page fails and shows its
// error screen, which offers to try again.
export async function getMember() {
  if (await sessionUnconfirmed()) {
    throw new SermoError(
      "internal",
      503,
      "The session could not be confirmed.",
    );
  }
  return getViewer();
}
