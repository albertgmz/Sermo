import "server-only";

import { getTranslations } from "next-intl/server";
import type { Crumb } from "@/components/staff/page-header";
import { getViewer } from "@/lib/sermo/session";
import { type PageKey, trailOf } from "./registry";

// The breadcrumb of a page of the panel, for `PageHeader`: the way up from `path` (the page's own
// address, ids filled in) as the registry draws it, in the viewer's words. A landing is named after
// its section. A page that names a record differently appends or replaces steps itself.
export async function staffTrail(path: string): Promise<Crumb[]> {
  const [viewer, t] = await Promise.all([
    getViewer(),
    getTranslations("admin.registry"),
  ]);
  return trailOf(viewer, path).map(({ screen, href }) => ({
    href,
    label: screen.landing
      ? t(`sections.${screen.section}`)
      : t(`screens.${screen.key as PageKey}`),
  }));
}
