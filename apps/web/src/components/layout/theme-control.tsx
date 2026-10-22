"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { ChoiceSelect } from "@/components/layout/choice-select";
import {
  currentTheme,
  isTheme,
  setTheme,
  subscribeTheme,
  THEMES,
  type Theme,
} from "@/components/layout/theme";
import { saveTheme } from "@/components/layout/theme-actions";

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

function useTheme() {
  return useSyncExternalStore(
    subscribeTheme,
    currentTheme,
    () => "system" as const,
  );
}

// Applies the choice here at once, then keeps it on the account (a guest's stays in this browser).
// A save that fails leaves the choice applied on this page.
export function chooseTheme(theme: Theme) {
  setTheme(theme);
  saveTheme(theme).catch(() => {});
}

export function ThemeControl({ className }: { className?: string }) {
  const t = useTranslations("layout.themeControl");
  const theme = useTheme();
  return (
    <ChoiceSelect
      label={t("label")}
      icon={ICONS[theme]}
      options={THEMES.map((value) => ({ value, label: t(value) }))}
      value={theme}
      onChange={(value) => isTheme(value) && chooseTheme(value)}
      className={className}
    />
  );
}
