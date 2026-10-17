import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/forum/empty-state";
import { LinkCard, LinkCards } from "@/components/staff/link-cards";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { getViewer } from "@/lib/sermo/session";
import type admin from "../../../../messages/en/admin.json";
import { SCREEN_ICONS } from "./icons";
import {
  type SectionId,
  type VisibleSection,
  visibleSections,
} from "./registry";
import { LinkCardsSkeleton } from "./skeletons";
import { staffTrail } from "./trail";

// A section's landing page (`/admin/sections/<id>`): the section's name and line, then a card for
// each of its screens the viewer may open. Moderation's landing is its own overview, which shows
// the same cards (`ScreenCards`) under its pending counts.

type LandingSection = Exclude<SectionId, "home" | "moderation">;
type Described = keyof typeof admin.registry.descriptions;

export async function landingMetadata(
  section: LandingSection,
): Promise<Metadata> {
  const t = await getTranslations("admin.registry");
  return { title: t(`sections.${section}`) };
}

export function SectionLanding({ section }: { section: LandingSection }) {
  const t = useTranslations("admin");
  return (
    <ScreenFrame
      trail={staffTrail(`/admin/sections/${section}`)}
      heading={t(`registry.sections.${section}`)}
      subtitle={t(`registry.sectionDescriptions.${section}`)}
      label={t("shell.aria.loadingPage")}
      fallback={<LinkCardsSkeleton />}
    >
      <SectionScreens section={section} />
    </ScreenFrame>
  );
}

async function SectionScreens({ section }: { section: SectionId }) {
  const [viewer, t] = await Promise.all([
    getViewer(),
    getTranslations("admin"),
  ]);
  const screens =
    visibleSections(viewer).find((visible) => visible.id === section)
      ?.screens ?? [];
  if (screens.length === 0) {
    return (
      <EmptyState
        title={t("landing.empty")}
        description={t("landing.emptyDescription")}
        className="rounded-lg border bg-card"
      />
    );
  }
  return (
    <ScreenCards label={t(`registry.sections.${section}`)} screens={screens} />
  );
}

// The cards of some screens: icon, name and line, each leading to the screen.
export async function ScreenCards({
  label,
  screens,
}: {
  label: string;
  screens: VisibleSection["screens"];
}) {
  const t = await getTranslations("admin.registry");
  return (
    <LinkCards label={label}>
      {screens.map((screen) => (
        <LinkCard
          key={screen.key}
          href={screen.path}
          icon={SCREEN_ICONS[screen.key]}
          title={t(`screens.${screen.key}`)}
          // Every listed screen has its line (`icons.test.ts`); detail screens are never shown here.
          description={t(`descriptions.${screen.key as Described}`)}
        />
      ))}
    </LinkCards>
  );
}
