import { expect, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { SCREEN_ICONS } from "./icons";
import { SCREENS, SECTIONS } from "./registry";
import { SECTION_ICONS } from "./section-icons";

const registry = messages.admin.registry as {
  sections: Record<string, string>;
  sectionDescriptions: Record<string, string>;
  screens: Record<string, string>;
  descriptions: Record<string, string>;
};

// What the landing cards and the home show: every listed screen but the landings and the home.
const carded = SCREENS.filter(
  (screen) =>
    screen.listed !== false && !screen.landing && screen.key !== "home",
);

test("every section has an icon, a name and, but the home, a line", () => {
  for (const section of SECTIONS) {
    expect(SECTION_ICONS[section.id], section.id).toBeDefined();
    expect(registry.sections[section.id], section.id).toBeString();
    if (section.id !== "home") {
      expect(registry.sectionDescriptions[section.id], section.id).toBeString();
    }
  }
});

test("every screen a card shows has an icon, a name and a line, and nothing else has a line", () => {
  for (const screen of carded) {
    expect(SCREEN_ICONS[screen.key], screen.key).toBeDefined();
    expect(registry.screens[screen.key], screen.key).toBeString();
    expect(registry.descriptions[screen.key], screen.key).toBeString();
  }
  const keys = new Set(carded.map((screen) => screen.key as string));
  expect(
    Object.keys(registry.descriptions).filter((k) => !keys.has(k)),
  ).toEqual([]);
  expect(Object.keys(SCREEN_ICONS).filter((k) => !keys.has(k))).toEqual([]);
});
