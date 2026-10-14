import { expect, mock, test } from "bun:test";
import { translator } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) => translator(namespace),
}));
const { Control } = await import("./inventory");
const { WearForm } = await import("./wear-form");

const NOW = "2026-01-01T00:00:00.000Z";
// biome-ignore lint/suspicious/noExplicitAny: only the fields the control reads are faked
const entry = (effect: unknown, id = 31): any => ({
  id: 1,
  quantity: 1,
  state: "active",
  expiresAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  item: { id, name: "Star", isConsumable: false, effect },
});
// biome-ignore lint/suspicious/noExplicitAny: only the fields the control reads are faked
const appearance = (nameIconItemId: number | null): any => ({
  accentId: null,
  nameColorId: null,
  frameId: null,
  coverPresetId: null,
  nameIconItemId,
  available: {
    accents: [],
    nameColors: [],
    frames: [],
    nameIcons: [],
    covers: [],
  },
});
const ICON = { type: "nameIcon", icon: "star", position: "before" };

async function control(worn: number | null) {
  const node = (await Control({
    entry: entry(ICON),
    appearance: appearance(worn),
    threads: [],
    returnTo: "/credits",
  })) as { type: unknown; props: Record<string, unknown> };
  return node;
}

test("a name icon is worn through a wear form keyed by the shop item", async () => {
  const node = await control(null);
  expect(node.type).toBe(WearForm);
  expect(node.props).toMatchObject({
    look: "nameIconItemId",
    catalogId: 31,
    worn: false,
    itemName: "Star",
    returnTo: "/credits",
  });
});

test("the form offers to take it off only while that item's icon is worn", async () => {
  expect((await control(31)).props.worn).toBe(true);
  expect((await control(32)).props.worn).toBe(false);
});
