import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { fakeBackend, refusal } from "../groups/test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));
const cache = await import("next/cache");
const renewed: string[] = [];
mock.module("next/cache", () => ({
  ...cache,
  revalidatePath: (path: string) => renewed.push(path),
  revalidateTag: (tag: string) => renewed.push(tag),
}));

const {
  saveImage,
  deleteImage,
  saveColour,
  deleteColour,
  setImageActive,
  setColourActive,
  saveImageOrder,
  saveColourOrder,
} = await import("./actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => {
  backend?.restore();
  renewed.length = 0;
});
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => cache);
});

const STAMPS = {
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const IMAGE = {
  id: 3,
  kind: "frame",
  name: "Gold",
  image: { fileId: 8, url: "/api/v1/files/8" },
  placement: { width: 120, left: -10, top: -10, scale: 80 },
  position: 0,
  isActive: true,
  ...STAMPS,
};
const COLOUR = {
  id: 5,
  kind: "accent",
  name: "Teal",
  color: "#112233",
  foreground: "#ffffff",
  position: 0,
  isActive: true,
  ...STAMPS,
};

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function redirectedTo(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return String((error as { digest?: unknown }).digest);
  }
  return undefined;
}

test("a new frame names its uploaded file and leaves the placement to the backend", async () => {
  backend = fakeBackend({ "catalogImages.create": () => Response.json(IMAGE) });
  const digest = await redirectedTo(() =>
    saveImage(
      null,
      form({
        kind: "frame",
        name: "Gold",
        fileId: "8",
        position: "",
        isActive: "on",
        width: "",
        left: "",
        top: "",
        scale: "",
      }),
    ),
  );
  expect(digest).toMatch(/;\/admin\/appearance\/frames\?notice=created;/);
  expect(backend.asked[0].body).toEqual({
    kind: "frame",
    name: "Gold",
    fileId: 8,
    isActive: true,
  });
  expect(renewed).toContain("site");
});

test("a new entry without a picture is refused before the backend is asked", async () => {
  backend = fakeBackend({});
  expect(
    await saveImage(null, form({ kind: "thread_cover", name: "Sky" })),
  ).toEqual({
    fields: { fileId: messages.adminAppearance.errors.fileRequired },
  });
  expect(backend.asked).toEqual([]);
});

test("an edit sends the placement only when a number was changed", async () => {
  backend = fakeBackend({ "catalogImages.update": () => Response.json(IMAGE) });
  const same = {
    kind: "frame",
    id: "3",
    name: "Gold",
    width: "120",
    left: "-10",
    top: "-10",
    scale: "80",
    "before.width": "120",
    "before.left": "-10",
    "before.top": "-10",
    "before.scale": "80",
  };
  await redirectedTo(() => saveImage(null, form({ ...same, fileId: "9" })));
  await redirectedTo(() => saveImage(null, form({ ...same, left: "-12.5" })));
  expect(backend.asked.map((call) => call.body)).toEqual([
    { name: "Gold", fileId: 9, isActive: false },
    {
      name: "Gold",
      placement: { width: 120, left: -12.5, top: -10, scale: 80 },
      isActive: false,
    },
  ]);
});

test("reset to measured sends a null placement and no numbers", async () => {
  backend = fakeBackend({ "catalogImages.update": () => Response.json(IMAGE) });
  const digest = await redirectedTo(() =>
    saveImage(
      null,
      form({
        kind: "frame",
        id: "3",
        name: "Gold",
        intent: "reset",
        width: "1",
        left: "1",
        top: "1",
        scale: "1",
      }),
    ),
  );
  expect(digest).toMatch(/notice=reset/);
  expect(backend.asked[0].body).toEqual({
    name: "Gold",
    placement: null,
    isActive: false,
  });
});

test("a placement that is not numbers, a kind or an id that does not exist are refused", async () => {
  backend = fakeBackend({});
  expect(
    await saveImage(
      null,
      form({
        kind: "frame",
        id: "3",
        name: "G",
        width: "wide",
        left: "0",
        top: "0",
        scale: "80",
      }),
    ),
  ).toEqual({
    fields: { placement: messages.adminAppearance.errors.placementNumbers },
  });
  expect(await saveImage(null, form({ kind: "badge", name: "G" }))).toEqual({
    error: messages.adminAppearance.errors.kind,
  });
  expect(
    await saveImage(null, form({ kind: "frame", id: "0x3", name: "G" })),
  ).toEqual({ error: messages.adminAppearance.errors.id });
  expect(backend.asked).toEqual([]);
});

test("the refusal of a frame that could not be measured is shown", async () => {
  backend = fakeBackend({
    "catalogImages.create": () =>
      refusal(422, "validation", "This frame needs a placement."),
  });
  expect(
    await saveImage(null, form({ kind: "frame", name: "G", fileId: "8" })),
  ).toEqual({ error: "This frame needs a placement." });
});

test("a frame picture whose opening could not be measured asks for the placement with a line of its own", async () => {
  backend = fakeBackend({
    "catalogImages.create": () =>
      refusal(
        422,
        "validation",
        "The frame's opening could not be measured; give a placement.",
      ),
  });
  expect(
    await saveImage(null, form({ kind: "frame", name: "G", fileId: "8" })),
  ).toEqual({
    fields: {
      placementNeeded: messages.adminAppearance.errors.placementNeeded,
    },
  });
});

test("deleting a picture in use says it was deactivated instead", async () => {
  backend = fakeBackend({
    "catalogImages.delete": () =>
      Response.json({ ok: true, deactivated: true }),
  });
  const digest = await redirectedTo(() =>
    deleteImage(null, form({ kind: "profile_cover", id: "3" })),
  );
  expect(digest).toMatch(/;\/admin\/appearance\/covers\?notice=deactivated;/);
  expect(await deleteImage(null, form({ kind: "x", id: "3" }))).toEqual({
    error: messages.adminAppearance.errors.id,
  });
});

test("an accent is sent with its foreground, a name colour without", async () => {
  backend = fakeBackend({
    "paletteColors.create": () => Response.json(COLOUR),
  });
  const typed = {
    name: "Teal",
    color: " #112233 ",
    foreground: "#ffffff",
    position: "4",
    isActive: "on",
  };
  const digest = await redirectedTo(() =>
    saveColour(null, form({ ...typed, kind: "accent" })),
  );
  await redirectedTo(() => saveColour(null, form({ ...typed, kind: "name" })));
  expect(digest).toMatch(/;\/admin\/appearance\/accents\?notice=created;/);
  expect(backend.asked.map((call) => call.body)).toEqual([
    {
      kind: "accent",
      name: "Teal",
      color: "#112233",
      foreground: "#ffffff",
      position: 4,
      isActive: true,
    },
    {
      kind: "name",
      name: "Teal",
      color: "#112233",
      position: 4,
      isActive: true,
    },
  ]);
});

test("the refusal of a colour is shown under its field", async () => {
  backend = fakeBackend({
    "paletteColors.update": () =>
      Response.json(
        {
          error: {
            code: "validation",
            message: "Invalid input",
            issues: [{ path: ["color"], message: "Use a #rrggbb color." }],
          },
        },
        { status: 422 },
      ),
  });
  expect(
    await saveColour(
      null,
      form({ kind: "prefix", id: "5", name: "A", color: "red" }),
    ),
  ).toEqual({ error: undefined, fields: { color: "Use a #rrggbb color." } });
  expect(
    await saveColour(null, form({ kind: "prefix", name: "A", position: "x" })),
  ).toEqual({ fields: { position: messages.adminAppearance.errors.whole } });
});

test("deleting a colour in use is deactivated, an unused one deleted", async () => {
  let deactivated = true;
  backend = fakeBackend({
    "paletteColors.delete": () => Response.json({ ok: true, deactivated }),
  });
  expect(
    await redirectedTo(() =>
      deleteColour(null, form({ kind: "name", id: "5" })),
    ),
  ).toMatch(/name-colors\?notice=deactivated/);
  deactivated = false;
  expect(
    await redirectedTo(() =>
      deleteColour(null, form({ kind: "prefix", id: "5" })),
    ),
  ).toMatch(/prefix-colors\?notice=deleted/);
});

test("a row's switch sends the flipped state alone and renews the pages", async () => {
  backend = fakeBackend({
    "catalogImages.update": () => Response.json(IMAGE),
    "paletteColors.update": () => Response.json(COLOUR),
  });
  expect(
    await setImageActive(null, form({ kind: "frame", id: "3", active: "0" })),
  ).toBeNull();
  expect(
    await setColourActive(null, form({ kind: "accent", id: "5", active: "1" })),
  ).toBeNull();
  expect(backend.asked.map((call) => [call.path, call.body])).toEqual([
    ["/api/v1/appearance/images/3", { isActive: false }],
    ["/api/v1/appearance/colors/5", { isActive: true }],
  ]);
  expect(renewed).toContain("site");
  expect(
    await setImageActive(null, form({ kind: "x", id: "3", active: "1" })),
  ).toEqual({ error: messages.adminAppearance.errors.id });
  expect(
    await setColourActive(null, form({ kind: "name", id: "x", active: "1" })),
  ).toEqual({ error: messages.adminAppearance.errors.id });
});

test("a refused switch shows the backend's message and renews nothing", async () => {
  backend = fakeBackend({
    "catalogImages.update": () =>
      refusal(
        422,
        "validation",
        "An entry without a picture cannot be active.",
      ),
  });
  expect(
    await setImageActive(null, form({ kind: "frame", id: "3", active: "1" })),
  ).toEqual({ error: "An entry without a picture cannot be active." });
  expect(renewed).toEqual([]);
});

test("saving the order sends only the entries whose number changed", async () => {
  backend = fakeBackend({
    "catalogImages.update": () => Response.json(IMAGE),
    "paletteColors.update": () => Response.json(COLOUR),
  });
  const digest = await redirectedTo(() =>
    saveImageOrder(
      null,
      form({
        kind: "thread_cover",
        "position.1": "20",
        "before.1": "10",
        "title.1": "Sky",
        "position.2": "10",
        "before.2": "20",
        "title.2": "Sea",
        "position.3": "30",
        "before.3": "30",
      }),
    ),
  );
  expect(digest).toMatch(
    /;\/admin\/appearance\/thread-covers\?notice=ordered;/,
  );
  const colours = await redirectedTo(() =>
    saveColourOrder(
      null,
      form({
        kind: "prefix",
        "position.5": "2",
        "before.5": "1",
        "position.6": "1",
        "before.6": "2",
      }),
    ),
  );
  expect(colours).toMatch(
    /;\/admin\/appearance\/prefix-colors\?notice=ordered;/,
  );
  expect(backend.asked.map((call) => [call.path, call.body])).toEqual([
    ["/api/v1/appearance/images/1", { position: 20 }],
    ["/api/v1/appearance/images/2", { position: 10 }],
    ["/api/v1/appearance/colors/5", { position: 2 }],
    ["/api/v1/appearance/colors/6", { position: 1 }],
  ]);
  expect(renewed).toContain("site");
});

test("an order with nothing changed asks nothing, a refusal names the entry and what was saved", async () => {
  backend = fakeBackend({
    "catalogImages.update": () => refusal(422, "validation", "Too high."),
  });
  expect(
    await redirectedTo(() =>
      saveImageOrder(
        null,
        form({ kind: "frame", "position.1": "10", "before.1": "10" }),
      ),
    ),
  ).toMatch(/frames\?notice=ordered/);
  expect(backend.asked).toEqual([]);
  const state = await saveImageOrder(
    null,
    form({
      kind: "frame",
      "position.1": "20",
      "before.1": "10",
      "title.1": "Gold",
    }),
  );
  expect(state).toEqual({ error: messages.admin.ordering.none });
  expect(backend.asked).toHaveLength(1);
  expect(renewed).toEqual([]);
  expect(await saveImageOrder(null, form({ kind: "x" }))).toEqual({
    error: messages.adminAppearance.errors.kind,
  });
  expect(
    await saveColourOrder(
      null,
      form({ kind: "name", "position.5": "x", "before.5": "1" }),
    ),
  ).toEqual({
    fields: { "position.5": messages.adminAppearance.errors.whole },
  });
});
