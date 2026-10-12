import { expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));
mock.module("@/app/(main)/account/data", () => ({
  getSelf: async () => ({
    profile: {
      about: "",
      location: "",
      website: "",
      birthday: { day: 4, month: 5 },
      socials: { discord: "", telegram: "", x: "" },
    },
    birthYear: 1990,
  }),
  getWorn: async () => ({}),
  getRenameUnits: async () => 0,
  shopHref: "/credits",
}));

const { AboutSection } = await import("./profile-forms");

async function markup(element: React.ReactNode) {
  return new Response(await renderToReadableStream(element)).text();
}

test("Enter in the profile form saves it: the clear control belongs to a form of its own", async () => {
  const html = await markup(
    await AboutSection({ searchParams: Promise.resolve({}) }),
  );
  const profileForm = html.slice(
    html.indexOf("<form"),
    html.indexOf("</form>"),
  );
  // The submit button a browser takes for Enter is the first one the form owns.
  const owned = [...profileForm.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
    .map((match) => match[0])
    .filter((button) => !/\sform="/.test(button));
  expect(owned).toHaveLength(1);
  expect(owned[0]).toContain(messages.account.about.submit);
  expect(profileForm).not.toContain('name="clear"');
  // The clear button is there, handed to another form.
  const clear = profileForm.match(
    /<button\b[^>]*form="clear-birthday"[^>]*>[\s\S]*?<\/button>/,
  );
  expect(clear?.[0]).toContain(messages.account.about.clearBirthday);
  expect(html).toContain('<form id="clear-birthday"');
});
