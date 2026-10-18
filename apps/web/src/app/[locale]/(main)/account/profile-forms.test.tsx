import { expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { translator, withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
mock.module("next-intl/server", () => ({
  getFormatter: async () => ({ dateTime: () => "" }),
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));
mock.module("@/app/[locale]/(main)/account/data", () => ({
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

const { About } = await import("./profile-forms");

async function markup(element: React.ReactNode) {
  return new Response(await renderToReadableStream(withIntl(element))).text();
}

test("no profile row has a save button: each is a form that saves itself", async () => {
  const html = await markup(await About());
  expect(html).not.toContain('type="submit"');
  expect(html).not.toContain("Save profile");
  // About, location, website, birthday, Discord, Telegram and X: one form each.
  expect(html.match(/<form\b/g)).toHaveLength(7);
});

test("the three fields of the birthday are one row, so they save together", async () => {
  const html = await markup(await About());
  const forms = html.split("<form").slice(1);
  const birthday = forms.find((form) =>
    form.includes(messages.account.about.birthdayLabel),
  );
  expect(birthday).toBeDefined();
  for (const name of ["day", "month", "year"]) {
    expect(birthday).toContain(`name="${name}"`);
  }
  expect(birthday).not.toContain('name="location"');
});
