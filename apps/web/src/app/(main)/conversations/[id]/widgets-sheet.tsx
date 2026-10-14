"use client";

import { PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

// The conversation's widgets below the desktop layout, where the aside column does not exist: a
// header button opens them in a drawer. The widgets are the same server-rendered components the
// aside shows; this copy is mounted only while the drawer is open (the aside's is always in the
// page, hidden by CSS below the desktop layout).
export function WidgetsSheet({
  label,
  title,
  description,
  children,
}: {
  label: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Sheet>
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
        className="w-[min(24rem,92vw)] gap-0 [&_[data-slot=sheet-close]]:top-2 [&_[data-slot=sheet-close]]:right-2 [&_[data-slot=sheet-close]]:size-10"
      >
        <SheetHeader className="border-b py-2 pr-14">
          <SheetTitle className="flex min-h-10 items-center">
            {title}
          </SheetTitle>
          <SheetDescription className="sr-only">{description}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-(--page-gap) overflow-y-auto p-3">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
