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
// The site's +18 mode, which offers the profile's +18 mark.
let adultMode = false;
mock.module("@/lib/sermo/site", () => ({
  getSite: async () => ({ adultMode }),
}));
mock.module("@/app/[locale]/(main)/account/data", () => ({
  getSelf: async () => ({
    profile: {
      about: "",
      location: "",
      website: "",
      birthday: { day: 4, month: 5 },
      socials: { discord: "", telegram: "", x: "" },
      isAdult: true,
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

test("while the +18 mode is on the profile's +18 mark is a row of its own, which saves on or off", async () => {
  adultMode = true;
  try {
    const html = await markup(await About());
    const forms = html.split("<form").slice(1);
    expect(forms).toHaveLength(8);
    const adult = forms.find((form) =>
      form.includes(messages.account.about.adultLabel),
    );
    expect(adult).toMatch(
      /<input[^>]*type="checkbox"[^>]*name="isAdult"[^>]*checked=""/,
    );
    // Its marker keeps the row from reading as emptied when the box is unticked.
    expect(adult).toContain('name="adultShown"');
  } finally {
    adultMode = false;
  }
});
