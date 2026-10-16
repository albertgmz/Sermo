"use client";

import { useRef, useState } from "react";
import { ComposerSheet } from "@/components/forum/composer";
import { CreateFlow } from "@/components/forum/create-flow";
import {
  type CreateVariant,
  TriggerContent,
  triggerClass,
} from "@/components/layout/create-trigger";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import type { OpenedProps } from "@/components/ui/lazy-popup";

export type CreatePopupProps = { variant: CreateVariant; label: string };

// The button and the dialog it opens, loaded when the plain button of `CreateButton` is pressed and
// mounted open. It stays mounted when it is closed, so what was written is there when it is opened
// again, and closing returns focus to the button. A post that was taken navigates away, which does
// not draw the layout anew: the flow is started over (new key) and the dialog closed.
export default function CreatePopup(props: CreatePopupProps & OpenedProps) {
  const { variant, label } = props;
  const [open, setOpen] = useState(true);
  // Counts the times the dialog was opened: each one starts at the choice of what to write.
  const [visit, setVisit] = useState(1);
  const [generation, setGeneration] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  function change(next: boolean) {
    if (next) setVisit((count) => count + 1);
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger aria-label={label} className={triggerClass(variant)}>
        <TriggerContent variant={variant} label={label} />
      </DialogTrigger>
      <ComposerSheet
        open={open}
        initialFocus={() =>
          root.current?.querySelector<HTMLElement>("[data-create-option]") ??
          null
        }
      >
        <CreateFlow
          key={generation}
          visit={visit}
          rootRef={root}
          onSent={() => {
            setOpen(false);
            setGeneration((count) => count + 1);
          }}
        />
      </ComposerSheet>
    </Dialog>
  );
}
