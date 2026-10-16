"use client";

import { useLayoutEffect, useState } from "react";
import { HYDRATED_FIELD } from "@/app/[locale]/(auth)/native-form";

// Goes inside a form whose action tells a page that was drawn by React from one that was not (see
// `native-form.ts`). The page the server draws carries it empty; React sets "1" in a layout
// effect, which runs in the same commit that hydrates the form, so there is no moment in which
// React handles the submit and the field is still empty. A form sent before that carries the
// empty one. `autoComplete="off"`: a browser that restores field values on a reload must not put
// the "1" of an earlier visit in a page that is not hydrated.
export function HydrationMark() {
  const [hydrated, setHydrated] = useState("");
  useLayoutEffect(() => setHydrated("1"), []);
  return (
    <input
      type="hidden"
      name={HYDRATED_FIELD}
      value={hydrated}
      autoComplete="off"
    />
  );
}
