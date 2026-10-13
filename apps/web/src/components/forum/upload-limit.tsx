"use client";

import { createContext, useContext } from "react";

// The most a member's file may have, in bytes, as the site allows it: read once on the server and
// handed down, so every upload form can say it in its help text. Null when it is not known.
const UploadLimit = createContext<number | null>(null);

export function UploadLimitProvider({
  bytes,
  children,
}: {
  bytes: number | null;
  children: React.ReactNode;
}) {
  return <UploadLimit.Provider value={bytes}>{children}</UploadLimit.Provider>;
}

export const useUploadLimit = () => useContext(UploadLimit);
