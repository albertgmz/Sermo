import "server-only";

import { getTranslations } from "next-intl/server";
import { cache } from "react";
import { getViewer } from "@/lib/sermo/session";
import { type SectionId, visibleSections } from "./registry";

export type NavScreen = {
  href: string;
  label: string;
  // The labelled sub-group of "Groups and permissions" the screen sits in.
  group?: { id: string; label: string };
};

export type NavSection = {
  id: SectionId;
  label: string;
  // The section's landing, when the viewer may open it: the heading links there.
  href?: string;
  screens: NavScreen[];
};

// The sections the viewer may open, with the labels the navigation, the drawer and the top bar
// show: asked once per request, from the registry and the one `auth.me` answer.
export const getStaffNavigation = cache(async (): Promise<NavSection[]> => {
  const [viewer, t] = await Promise.all([
    getViewer(),
    getTranslations("admin.registry"),
  ]);
  return visibleSections(viewer).map((section) => ({
    id: section.id,
    label: t(`sections.${section.id}`),
    href: section.landing?.path,
    screens: section.screens.map((screen) => ({
      href: screen.path,
      label: t(`screens.${screen.key}`),
      group: screen.group && {
        id: screen.group,
        label: t(`groups.${screen.group}`),
      },
    })),
  }));
});
