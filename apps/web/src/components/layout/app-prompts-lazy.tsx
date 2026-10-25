"use client";

import dynamic from "next/dynamic";

// The cards draw nothing until the cookie banner is settled and the visit has a few pages, so their
// code (the install and push helpers with it) comes after the page is interactive instead of with
// it. So do a guest's invitations to create an account, which wait for the banner as well.
export const LazyAppPrompts = dynamic(
  () =>
    import("@/components/layout/app-prompts").then(
      (module) => module.AppPrompts,
    ),
  { ssr: false },
);

export const LazySignupNudges = dynamic(
  () =>
    import("@/components/layout/signup-nudges").then(
      (module) => module.SignupNudges,
    ),
  { ssr: false },
);
