import { useTranslations } from "next-intl";
import { Notice } from "@/components/staff/notice";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { FormSkeleton } from "../groups/skeletons";

export type Screen =
  | "general"
  | "home"
  | "members"
  | "antispam"
  | "warnings"
  | "uploads"
  | "seo"
  | "levels"
  | "cookies";

type Params = Promise<{ notice?: string | string[] }>;

// The confirmation a save redirected with, shown above the first panel.
export function SettingsNotice({ searchParams }: { searchParams: Params }) {
  return (
    <Notice
      namespace="adminSetup.notices"
      searchParams={searchParams}
      shown={["saved", "added", "deleted", "asked"]}
    />
  );
}

// The frame of a settings screen: the heading at once, then the form once the settings are read.
export function SettingsScreen({
  screen,
  searchParams,
  children,
}: {
  screen: Screen;
  searchParams: Params;
  children: React.ReactNode;
}) {
  const t = useTranslations(`adminSetup.pages.${screen}`);
  const loading = useTranslations("adminSetup.loading");
  return (
    <ScreenFrame
      heading={t("heading")}
      subtitle={t("subtitle")}
      label={loading("label")}
      fallback={<FormSkeleton />}
    >
      <SettingsNotice searchParams={searchParams} />
      {children}
    </ScreenFrame>
  );
}
