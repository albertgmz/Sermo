"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
// again, and closing returns focus to the button. A post that was taken redirects, which draws the
// layout anew and with it the dialog, empty and closed; a navigation of any other kind closes it.
export default function CreatePopup(props: CreatePopupProps & OpenedProps) {
  const { variant, label } = props;
  const [open, setOpen] = useState(true);
  // Counts the times the dialog was opened: each one starts at the choice of what to write.
  const [visit, setVisit] = useState(1);

  // The dialog lives in the layout, so a navigation the member makes while it is open (Back, a
  // link in the page behind) must close it.
  const pathname = usePathname();
  const shown = useRef(pathname);
  useEffect(() => {
    if (shown.current === pathname) return;
    shown.current = pathname;
    setOpen(false);
  }, [pathname]);

  function change(next: boolean) {
    if (next) setVisit((count) => count + 1);
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger aria-label={label} className={triggerClass(variant)}>
        <TriggerContent variant={variant} label={label} />
      </DialogTrigger>
      <ComposerSheet open={open}>
        <CreateFlow visit={visit} />
      </ComposerSheet>
    </Dialog>
  );
}
