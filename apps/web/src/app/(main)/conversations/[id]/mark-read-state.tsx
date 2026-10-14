"use client";

import { createContext, useMemo, useState } from "react";

export type MarkReadState = {
  failed: boolean;
  setFailed: (to: boolean) => void;
};

// Whether the automatic mark-as-read of the page has failed. The page's sync (under the
// messages) reports it and the "Mark as read" card (in the widgets) listens, so the card is drawn
// only when the automatic mark did not do its work.
export const MarkReadContext = createContext<MarkReadState>({
  failed: false,
  setFailed: () => {},
});

export function MarkReadProvider({ children }: { children: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  const value = useMemo(() => ({ failed, setFailed }), [failed]);
  return <MarkReadContext value={value}>{children}</MarkReadContext>;
}
