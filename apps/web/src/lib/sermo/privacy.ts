import { privacyLogRetention } from "@sermo/core/contracts";
import { cache } from "react";
import { call } from "./client";
import { SermoError } from "./errors";

// How many days the backend keeps its log of addresses, devices and places; null when it cannot
// say (the pages then leave the number out rather than fail).
export const getLogRetentionDays = cache(async (): Promise<number | null> => {
  try {
    return (await call(privacyLogRetention, {})).days;
  } catch (error) {
    if (error instanceof SermoError) return null;
    throw error;
  }
});
