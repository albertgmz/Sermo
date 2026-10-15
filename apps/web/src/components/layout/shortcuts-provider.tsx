"use client";

import { useHotkeySequences, useHotkeys } from "@tanstack/react-hotkeys";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createShortcuts, OPTIONS } from "./shortcut-bindings";
import { SEQUENCE_TIMEOUT } from "./shortcuts";
import { ShortcutsHelp } from "./shortcuts-help";

// The site's keyboard shortcuts, registered once for the whole page. `enabled` is the member's
// preference (a guest has the shortcuts on). `?` opens the help dialog.
export function ShortcutsProvider({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  const [{ hotkeys, sequences }] = useState(() =>
    createShortcuts({
      go: (path) => router.push(path),
      openHelp: () => setHelpOpen(true),
    }),
  );
  useHotkeys(hotkeys, { ...OPTIONS, enabled });
  useHotkeySequences(sequences, {
    ...OPTIONS,
    enabled,
    timeout: SEQUENCE_TIMEOUT,
  });
  return (
    <ShortcutsHelp open={enabled && helpOpen} onOpenChange={setHelpOpen} />
  );
}
