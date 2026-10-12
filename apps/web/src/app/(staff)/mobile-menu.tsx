"use client";

import { Menu } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { StaffNavigation } from "./navigation";
import type { NavSection } from "./navigation-data";

// The navigation as a drawer, opened from the header button below the desktop layout.
export function StaffMenu({ sections }: { sections: NavSection[] }) {
  const t = useTranslations("admin.shell");
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("aria.openMenu")}
            className="-ml-2 size-10 lg:hidden"
          />
        }
      >
        <Menu className="size-6" />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[min(20rem,85vw)] gap-0 [&_[data-slot=sheet-close]]:top-2 [&_[data-slot=sheet-close]]:right-2 [&_[data-slot=sheet-close]]:size-10"
      >
        <SheetHeader className="border-b py-2">
          <SheetTitle className="flex min-h-10 items-center">
            {t("menuTitle")}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {t("menuDescription")}
          </SheetDescription>
        </SheetHeader>
        <div className="overflow-y-auto p-2">
          <StaffNavigation
            sections={sections}
            label={t("aria.navigation")}
            onNavigate={() => setOpen(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
