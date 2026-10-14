import { expect, test } from "bun:test";
import { userNameProps } from "@/components/forum/user-name";
import { isHexColor } from "@/lib/css-color";

test("only #rrggbb is a colour", () => {
  for (const good of ["#0ea5e9", "#0EA5E9", "#000000"]) {
    expect(isHexColor(good), good).toBe(true);
  }
  for (const bad of [
    "",
    "red",
    "#fff",
    "#0ea5e9;}body{display:none",
    "#0ea5e9 ",
    "url(x)",
    "#gggggg",
    null,
    undefined,
    7,
  ]) {
    expect(isHexColor(bad), String(bad)).toBe(false);
  }
});

test("a name colour that is not a colour is not put in the style", () => {
  expect(userNameProps({ nameColor: "#0ea5e9" }).style).toEqual({
    "--ink": "#0ea5e9",
  });
  for (const nameColor of ["red", "#0ea5e9;}x{", "var(--x)", ""]) {
    expect(userNameProps({ nameColor }), nameColor).toEqual({});
  }
});
