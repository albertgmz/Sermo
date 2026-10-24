"use client";

import dynamic from "next/dynamic";

// The cards draw nothing until the cookie banner is settled and the visit has a few pages, so their
// code (the install and push helpers with it) comes after the page is interactive instead of with
// it.
export const LazyAppPrompts = dynamic(
  () =>
    import("@/components/layout/app-prompts").then(
      (module) => module.AppPrompts,
    ),
  { ssr: false },
);
