"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { revealTarget } from "@/components/staff/reveal";

// Brings the row the address names (`?setting=<name>`, where the panel's search leads) into view
// once the form is drawn, and again when a search on the same screen names another row. A name
// with rows under it (`levelTitles`) leads to the first of them. Drawn beside the form, inside its
// streamed panel, so it mounts with the rows.
export function SettingTarget() {
  const name = useSearchParams().get("setting");
  useEffect(() => {
    if (name)
      revealTarget(
        document.querySelector("main") ?? document,
        new URLSearchParams({ setting: name }).toString(),
      );
  }, [name]);
  return null;
}
