"use client";

import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GROUPS, SHORTCUTS } from "./shortcuts";

function KeyCap({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-h-6 min-w-6 items-center justify-center rounded border bg-muted px-1.5 font-mono text-xs text-foreground">
      {children}
    </kbd>
  );
}

// Every shortcut, by group. A sequence reads `g` then `h`; a key held with another reads `Ctrl` +
// `\`.
export function ShortcutsList() {
  const t = useTranslations("layout.shortcuts");
  return (
    <div className="space-y-4">
      {GROUPS.map((group) => (
        <section key={group} aria-labelledby={`shortcuts-${group}`}>
          <h3
            id={`shortcuts-${group}`}
            className="mb-1 text-xs font-medium text-muted-foreground"
          >
            {t(`groups.${group}`)}
          </h3>
          <dl className="divide-y rounded-lg border">
            {SHORTCUTS.filter((shortcut) => shortcut.group === group).map(
              (shortcut) => (
                <div
                  key={shortcut.id}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <dt className="min-w-0 text-sm">
                    {t(`actions.${shortcut.id}`)}
                  </dt>
                  <dd className="flex shrink-0 items-center gap-1.5">
                    {shortcut.keys.map((key, index) => (
                      <span key={key} className="flex items-center gap-1.5">
                        {index > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {shortcut.native ? "+" : t("then")}
                          </span>
                        )}
                        <KeyCap>{key}</KeyCap>
                      </span>
                    ))}
                  </dd>
                </div>
              ),
            )}
          </dl>
        </section>
      ))}
    </div>
  );
}

// The help dialog. Esc closes it, like every dialog of the site.
export function ShortcutsHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("layout.shortcuts");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <ShortcutsList />
      </DialogContent>
    </Dialog>
  );
}
