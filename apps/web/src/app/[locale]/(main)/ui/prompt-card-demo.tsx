"use client";

import { useState } from "react";
import { PromptCard } from "@/components/layout/prompt-card";
import { Button } from "@/components/ui/button";

// The card that offers the app or notifications, in the flow of the page (on the pages it floats at
// the foot of the screen). "Not now" puts it away; the button brings it back.
export function PromptCardDemo({ icon }: { icon: React.ReactNode }) {
  const [shown, setShown] = useState(true);
  const [busy, setBusy] = useState(false);
  if (!shown)
    return (
      <Button variant="outline" onClick={() => setShown(true)}>
        Show the card again
      </Button>
    );
  return (
    <PromptCard
      inline
      icon={icon}
      title="Notifications on this device"
      action={{
        label: busy ? "Turning on" : "Turn on",
        onClick: () => setBusy(true),
      }}
      dismiss={{ label: "Not now", onClick: () => setShown(false) }}
      busy={busy}
    >
      Hear about replies, mentions and messages when the forum is closed.
    </PromptCard>
  );
}
