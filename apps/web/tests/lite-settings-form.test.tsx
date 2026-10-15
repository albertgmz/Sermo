import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "../src/i18n/messages";
import { LITE_CATEGORIES, parseLiteCookie } from "../src/lib/lite-preferences";

// The form's pending state comes from the nearest <form action>, which a
// server render never has; stand it in with a switch.
let pending = false;
const dom = await import("react-dom");
mock.module("react-dom", () => ({
  ...dom,
  useFormStatus: () => ({
    pending,
    data: null,
    method: null,
    action: null,
  }),
}));
// A stand-in for one hook keeps the other exports of the library, so a module that imports
// another of them still links after this suite has run.
const realIntl = { ...(await import("next-intl")) };
mock.module("next-intl", () => ({
  ...realIntl,
  useLocale: () => "en",
  useTranslations: (namespace: string) => (key: string) => {
    let value: unknown = messages;
    for (const part of `${namespace}.${key}`.split(".")) {
      value = (value as Record<string, unknown> | undefined)?.[part];
    }
    return typeof value === "string" ? value : key;
  },
}));
// The real actions reach the backend client, which only a server may import.
mock.module("server-only", () => ({}));
const realActions = { ...(await import("@/app/[locale]/(main)/actions")) };
mock.module("@/app/[locale]/(main)/actions", () => ({
  ...realActions,
  setLiteMode: async () => {},
}));

const { LiteSettingsForm } = await import(
  "../src/app/[locale]/(main)/data-saver/settings-form"
);

type Control = { name: string; value: string; disabled: boolean };

function controls(masterOn: boolean, isPending: boolean): Control[] {
  pending = isPending;
  const html = renderToStaticMarkup(
    createElement(LiteSettingsForm, {
      state: parseLiteCookie(masterOn ? "all.avatars" : "avatars"),
      returnTo: "/data-saver?saved=1",
    }),
  );
  pending = false;
  const form = html.slice(html.indexOf("<form"), html.indexOf("</form>"));
  return [...form.matchAll(/<(?:input|button)\b[^>]*>/g)].map(([tag]) => ({
    name: /\bname="([^"]*)"/.exec(tag)?.[1] ?? "",
    value: /\bvalue="([^"]*)"/.exec(tag)?.[1] ?? "",
    disabled: /\bdisabled(?:=|\s|>|\/)/.test(tag),
  }));
}

const submitted = (list: Control[]) =>
  list
    .filter((control) => control.name)
    .map(({ name, value }) => [name, value]);

test("the settings controls accept edits while idle", () => {
  for (const master of [false, true]) {
    const editable = controls(master, false).filter(
      (control) => control.name === "mode" || control.name === "category",
    );
    expect(editable.length).toBe(1 + LITE_CATEGORIES.length + 1);
    expect(editable.some((control) => control.disabled)).toBe(false);
  }
});

test("every editable control and the save button are disabled while the save is pending", () => {
  for (const master of [false, true]) {
    const list = controls(master, true);
    // Only the hidden inputs stay enabled: the checkboxes, the locked mirror
    // rows and the save button are all disabled.
    expect(
      list
        .filter((control) => !control.disabled)
        .map(({ name, value }) => [name, value]),
    ).toEqual([
      ["returnTo", "/data-saver?saved=1"],
      ["mode", "custom"],
    ]);
  }
});

test("locking the controls leaves the submitted field set unchanged", () => {
  for (const master of [false, true]) {
    expect(submitted(controls(master, true))).toEqual(
      submitted(controls(master, false)),
    );
  }
  const names = controls(false, false).map((control) => control.name);
  expect(names).toContain("returnTo");
});
