import "server-only";

import { rowText, SETTING_ROWS } from "./admin/settings/search-rows";
import { type ScreenKey, type Standing, visibleSections } from "./registry";
import type { SearchEntry } from "./search-match";

// What the index takes of a permission (`permissions.definitions` items have these, in the
// viewer's language, as the permission screens show them).
export type SearchDefinition = {
  id: string;
  scope: "global" | "node";
  title: string;
  help: string;
  categoryTitle: string;
};

type Opened = { key: ScreenKey; href: string; path: string[]; label: string };

// The screen a permission result opens: the one that sets it on a forum, or on a group.
const PERMISSION_SCREENS = {
  node: "permissionsForums",
  global: "permissionsGroups",
} as const satisfies Record<SearchDefinition["scope"], ScreenKey>;

// The screens the viewer may open (the navigation's own list: listed, built and allowed), each
// with its label and the way down to it.
function openedScreens(viewer: Standing, t: (key: string) => string): Opened[] {
  return visibleSections(viewer).flatMap((section) => {
    const name = t(`admin.registry.sections.${section.id}`);
    const landing: Opened[] = section.landing
      ? [
          {
            key: section.landing.key,
            href: section.landing.path,
            path: [],
            label: name,
          },
        ]
      : [];
    return [
      ...landing,
      ...section.screens.map((screen) => ({
        key: screen.key,
        href: screen.path,
        path: screen.group
          ? [name, t(`admin.registry.groups.${screen.group}`)]
          : [name],
        label: t(`admin.registry.screens.${screen.key}`),
      })),
    ];
  });
}

// Everything the panel's search can find for this viewer: the screens they may open, the rows of
// the settings screens among them, and the permissions when they may open the permission screens.
// `t` reads a message by its full key; `definitions` is null when the viewer may not list them.
export function buildSearchIndex({
  viewer,
  t,
  definitions,
}: {
  viewer: Standing;
  t: (key: string) => string;
  definitions: readonly SearchDefinition[] | null;
}): SearchEntry[] {
  const screens = openedScreens(viewer, t);
  const opened = new Map(screens.map((screen) => [screen.key, screen]));
  const entries: SearchEntry[] = screens.map((screen) => ({
    kind: "screen",
    label: screen.label,
    help: "",
    id: "",
    path: screen.path,
    href: screen.href,
  }));
  for (const [key, rows] of Object.entries(SETTING_ROWS)) {
    const screen = opened.get(key as ScreenKey);
    if (!screen) continue;
    for (const row of rows) {
      const { name, label, help } = rowText(row);
      entries.push({
        kind: "setting",
        label: t(label),
        help: help ? t(help) : "",
        id: name,
        path: [...screen.path, screen.label],
        href: `${screen.href}?setting=${encodeURIComponent(name)}`,
      });
    }
  }
  for (const definition of definitions ?? []) {
    const screen = opened.get(PERMISSION_SCREENS[definition.scope]);
    if (!screen) continue;
    entries.push({
      kind: "permission",
      label: definition.title,
      help: definition.help,
      id: definition.id,
      path: [...screen.path, screen.label, definition.categoryTitle],
      href: `${screen.href}?permission=${encodeURIComponent(definition.id)}`,
    });
  }
  return entries;
}

// Whether the viewer may open a screen that permission results lead to: only then are the
// definitions read.
export const findsPermissions = (viewer: Standing) =>
  visibleSections(viewer).some((section) =>
    section.screens.some((screen) =>
      Object.values(PERMISSION_SCREENS).includes(
        screen.key as (typeof PERMISSION_SCREENS)[keyof typeof PERMISSION_SCREENS],
      ),
    ),
  );
