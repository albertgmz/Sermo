"use client";

import { useSyncExternalStore } from "react";
import { HYDRATED_FIELD } from "@/app/[locale]/(auth)/native-form";

const never = () => () => {};

// Goes inside a form whose action tells a page that was drawn by React from one that was not (see
// `native-form.ts`). The server's snapshot is empty, the browser's is "1": React draws the
// browser's right after it hydrates, and a form sent before that carries the empty one.
export function HydrationMark() {
  const hydrated = useSyncExternalStore(
    never,
    () => "1",
    () => "",
  );
  return <input type="hidden" name={HYDRATED_FIELD} value={hydrated} />;
}
