import "server-only";

import { authMe } from "@sermo/core/contracts";
import { cache } from "react";
import { call } from "./client";
import { SermoError } from "./errors";
import { callWith } from "./transport";

// The visitor as the backend sees them. A dead cookie is a guest; nothing is written here.
export const getViewer = cache(async () => {
  try {
    return await call(authMe, {});
  } catch (error) {
    if (error instanceof SermoError && error.code === "unauthenticated") {
      return callWith({}, authMe, {});
    }
    throw error;
  }
});
