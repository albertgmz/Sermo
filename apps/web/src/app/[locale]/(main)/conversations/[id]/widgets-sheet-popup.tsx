"use client";

import { PanelRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { OpenedProps } from "@/components/ui/lazy-popup";
import { usePopupFocus } from "@/components/ui/lazy-popup-focus";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export type WidgetsSheetPopupProps = {
  label: string;
  title: string;
  description: string;
  children: React.ReactNode;
};

// The drawer and its button, which Base UI draws. It is loaded when the plain button of
// `WidgetsSheet` is pressed and mounts open.
export default function WidgetsSheetPopup({
  label,
  title,
  description,
  children,
  openedBy,
}: WidgetsSheetPopupProps & OpenedProps) {
  const focus = usePopupFocus(openedBy);
  const [open, setOpen] = useState(true);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" className="h-10 px-2 text-xs lg:hidden" />
        }
      >
        <PanelRight />
        {label}
      </SheetTrigger>
      <SheetContent
        side="right"
        ref={focus.ref}
        initialFocus={focus.initialFocus}
        className="w-[min(24rem,92vw)] gap-0 [&_[data-slot=sheet-close]]:top-2 [&_[data-slot=sheet-close]]:right-2 [&_[data-slot=sheet-close]]:size-10"
      >
        <SheetHeader className="border-b py-2 pr-14">
          <SheetTitle className="flex min-h-10 items-center">
            {title}
          </SheetTitle>
          <SheetDescription className="sr-only">{description}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-(--page-gap) overflow-y-auto p-3 [&>*]:shrink-0">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
