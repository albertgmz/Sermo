"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useSyncExternalStore } from "react";
import {
  currentTheme,
  restoreTheme,
  setTheme,
  subscribeTheme,
  THEMES,
  type Theme,
} from "@/components/layout/theme";
import { cn } from "@/lib/utils";

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

// Three choices in one group. Compact shows icons only (the account menu, the footer); labelled
// writes the words too (the appearance page).
export function ThemeChoices({
  value,
  onChange,
  labelled = false,
  className,
}: {
  value: Theme;
  onChange: (theme: Theme) => void;
  labelled?: boolean;
  className?: string;
}) {
  const t = useTranslations("layout.themeControl");
  return (
    <fieldset
      aria-label={t("label")}
      className={cn("inline-flex rounded-lg border p-0.5", className)}
    >
      {THEMES.map((theme) => {
        const Icon = ICONS[theme];
        const selected = value === theme;
        return (
          <button
            key={theme}
            type="button"
            aria-pressed={selected}
            aria-label={labelled ? undefined : t(theme)}
            title={t(theme)}
            onClick={() => onChange(theme)}
            className={cn(
              "inline-flex min-h-10 min-w-10 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:min-h-8 md:min-w-8 [&_svg]:size-4",
              labelled && "px-3",
              selected && "bg-muted text-foreground",
            )}
          >
            <Icon aria-hidden="true" />
            {labelled && t(theme)}
          </button>
        );
      })}
    </fieldset>
  );
}

export function ThemeControl({
  labelled,
  className,
}: {
  labelled?: boolean;
  className?: string;
}) {
  const theme = useSyncExternalStore(
    subscribeTheme,
    currentTheme,
    () => "system" as const,
  );
  useLayoutEffect(restoreTheme, []);
  return (
    <ThemeChoices
      value={theme}
      onChange={setTheme}
      labelled={labelled}
      className={className}
    />
  );
}
