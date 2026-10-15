"use client";

import dynamic from "next/dynamic";

// The shortcuts draw nothing until `?` opens the help, so their code (the hotkeys library and the
// help dialog) comes after the page is interactive instead of with it.
export const LazyShortcuts = dynamic(
  () =>
    import("@/components/layout/shortcuts-provider").then(
      (module) => module.ShortcutsProvider,
    ),
  { ssr: false },
);
