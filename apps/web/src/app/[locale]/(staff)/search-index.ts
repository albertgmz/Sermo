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

// The rows of the settings screens the viewer may open. A row's path ends with its card's legend
// (unless the row is named after it), and the legend's words also find it, at the rank of help.
function settingEntries(
  opened: ReadonlyMap<ScreenKey, Opened>,
  t: (key: string) => string,
): SearchEntry[] {
  return Object.entries(SETTING_ROWS).flatMap(([key, groups]) => {
    const screen = opened.get(key as ScreenKey);
    if (!screen) return [];
    return groups.flatMap(({ legend, rows }) =>
      rows.map((row): SearchEntry => {
        const { name, label, help } = rowText(row);
        const card = t(legend);
        const title = t(label);
        return {
          kind: "setting",
          label: title,
          help: [card, help ? t(help) : ""].join(" "),
          id: name,
          path: [
            ...screen.path,
            screen.label,
            ...(card === title ? [] : [card]),
          ],
          href: `${screen.href}?setting=${encodeURIComponent(name)}`,
        };
      }),
    );
  });
}

function permissionEntries(
  opened: ReadonlyMap<ScreenKey, Opened>,
  definitions: readonly SearchDefinition[],
): SearchEntry[] {
  return definitions.flatMap((definition): SearchEntry[] => {
    const screen = opened.get(PERMISSION_SCREENS[definition.scope]);
    if (!screen) return [];
    return [
      {
        kind: "permission",
        label: definition.title,
        help: definition.help,
        id: definition.id,
        path: [...screen.path, screen.label, definition.categoryTitle],
        href: `${screen.href}?permission=${encodeURIComponent(definition.id)}`,
      },
    ];
  });
}

// Everything the panel's search can find for this viewer: the screens they may open, the rows of
// the settings screens among them, and the permissions when they may open a permission screen
// (only then is `definitions` asked for). `t` reads a message by its full key.
export async function buildSearchIndex({
  viewer,
  t,
  definitions,
}: {
  viewer: Standing;
  t: (key: string) => string;
  definitions: () => Promise<readonly SearchDefinition[]>;
}): Promise<SearchEntry[]> {
  const screens = openedScreens(viewer, t);
  const opened = new Map(screens.map((screen) => [screen.key, screen]));
  const permissions = Object.values(PERMISSION_SCREENS).some((key) =>
    opened.has(key),
  )
    ? permissionEntries(opened, await definitions())
    : [];
  return [
    ...screens.map(
      (screen): SearchEntry => ({
        kind: "screen",
        label: screen.label,
        help: "",
        id: "",
        path: screen.path,
        href: screen.href,
      }),
    ),
    ...settingEntries(opened, t),
    ...permissions,
  ];
}
