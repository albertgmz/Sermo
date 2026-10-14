import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { fakeBackend } from "../../groups/test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
const cache = await import("next/cache");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/cache", () => ({
  ...cache,
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

import { SETTINGS } from "../../credits/test-fixtures";

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => cache);
});

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

const { saveIdentity } = await import("./actions");

test("only the pictures that were changed are sent", async () => {
  backend = fakeBackend({ "settings.update": () => Response.json(SETTINGS) });
  const digest = await redirectedTo(() =>
    saveIdentity(
      null,
      form({
        logoFileId: "5",
        iconFileId: "",
        iconFileIdRemove: "",
        backdropFileId: "",
        backdropFileIdRemove: "1",
      }),
    ),
  );
  expect(digest).toMatch(/;\/admin\/settings\/identity\?notice=saved;/);
  expect(backend.asked).toHaveLength(1);
  expect(backend.asked[0].body).toEqual({
    logoFileId: 5,
    backdropFileId: null,
  });
});

test("nothing changed sends nothing; a bad file id is refused", async () => {
  backend = fakeBackend({});
  expect(
    await saveIdentity(null, form({ logoFileId: "", iconFileId: "" })),
  ).toEqual({
    notice: messages.adminSetup.identity.nothingChanged,
  });
  expect(await saveIdentity(null, form({ logoFileId: "abc" }))).toEqual({
    fields: { logoFileId: messages.adminSetup.identity.errors.file },
  });
  expect(backend.asked).toEqual([]);
});

test("the backend refusal is shown under the picture it names", async () => {
  backend = fakeBackend({
    "settings.update": () =>
      Response.json(
        {
          error: {
            code: "validation",
            message: "x",
            issues: [{ path: ["iconFileId"], message: "Wrong purpose." }],
          },
        },
        { status: 422 },
      ),
  });
  expect(await saveIdentity(null, form({ iconFileId: "6" }))).toEqual({
    fields: { iconFileId: "Wrong purpose." },
  });
});
