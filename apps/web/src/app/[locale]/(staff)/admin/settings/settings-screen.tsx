import { useTranslations } from "next-intl";
import { TabLinks } from "@/components/forum/tab-links";
import { Notice } from "@/components/staff/notice";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { type ScreenKey, screenByKey } from "../../registry";
import { FormSkeleton } from "../../skeletons";
import { staffTrail } from "../../trail";
import { ScrollToCurrent } from "./scroll-to-current";
import { SettingTarget } from "./setting-target";

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

// The registry screen of each settings page.
const KEYS = {
  general: "setupGeneral",
  home: "setupHome",
  members: "setupMembers",
  antispam: "setupAntispam",
  warnings: "setupWarnings",
  uploads: "setupUploads",
  seo: "setupSeo",
  levels: "setupLevels",
  cookies: "setupCookies",
} as const satisfies Record<Screen, ScreenKey>;

// The option groups the switcher offers, in order, then the identity page (which has its own
// frame). The warnings page sits under Users and has no switcher.
const GROUPS = [
  "general",
  "home",
  "members",
  "antispam",
  "uploads",
  "seo",
  "levels",
  "cookies",
] as const satisfies readonly Screen[];

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

// The switcher between the option groups: a row of links that scrolls sideways on a phone.
export function SettingsGroups({ current }: { current: Screen | "identity" }) {
  const t = useTranslations("admin.registry.screens");
  const nav = useTranslations("adminSetup.nav");
  return (
    <ScrollToCurrent>
      <TabLinks
        label={nav("label")}
        active={current}
        tabs={[...GROUPS, "identity" as const].map((value) => {
          const key = value === "identity" ? "setupIdentity" : KEYS[value];
          return {
            value,
            label: t(key),
            href: screenByKey(key).path,
          };
        })}
      />
    </ScrollToCurrent>
  );
}

// The frame of a settings screen: the header and the switcher at once, then the form once the
// settings are read.
export function SettingsScreen({
  screen,
  searchParams,
  actions,
  children,
}: {
  screen: Screen;
  searchParams: Params;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations(`adminSetup.pages.${screen}`);
  const loading = useTranslations("adminSetup.loading");
  return (
    <ScreenFrame
      trail={staffTrail(screenByKey(KEYS[screen]).path)}
      heading={t("heading")}
      subtitle={t("subtitle")}
      actions={actions}
      nav={screen !== "warnings" && <SettingsGroups current={screen} />}
      label={loading("label")}
      fallback={<FormSkeleton />}
    >
      <SettingsNotice searchParams={searchParams} />
      {children}
      <SettingTarget />
    </ScreenFrame>
  );
}
