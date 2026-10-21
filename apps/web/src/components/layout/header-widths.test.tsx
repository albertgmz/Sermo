import { afterAll, expect, mock, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { HEADER_TOOLS, REGISTER_BUTTON } from "./header-widths";

mock.module("server-only", () => ({}));
const intl = await import("next-intl");
const intlServer = await import("next-intl/server");
mock.module("next-intl", () => ({
  ...intl,
  useTranslations: () => (key: string) => key,
}));
mock.module("next-intl/server", () => ({
  ...intlServer,
  getTranslations: async () => (key: string) => key,
}));
const session = await import("@/lib/sermo/session");
mock.module("@/lib/sermo/session", () => ({
  ...session,
  getViewer: async () => ({ user: null }),
}));
const lite = await import("@/lib/lite-mode");
mock.module("@/lib/lite-mode", () => ({
  ...lite,
  getLiteState: async () => ({}),
}));

const { AccountTools, SiteHeader } = await import("./site-header");

afterAll(() => {
  mock.module("next-intl", () => intl);
  mock.module("next-intl/server", () => intlServer);
  mock.module("@/lib/sermo/session", () => session);
  mock.module("@/lib/lite-mode", () => lite);
});

type Props = { className?: string; href?: string; children?: ReactNode };

// Every element of a returned tree, without drawing the components inside it.
function elements(node: ReactNode): { type: unknown; props: Props }[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}

const classesOf = (element: { props: Props }) =>
  (element.props.className ?? "").split(" ");

// The widths themselves are measured by the phone suite (every English guest header control ends
// on the screen, and the cookie banner keeps its gutters); these keep the header using the sizes.
test("a guest's Create Account button takes the phone size below md and its usual one from md", async () => {
  const register = elements(await AccountTools()).find(
    (element) => element.props.href === "/register",
  );
  expect(register).toBeDefined();
  const classes = classesOf(register as { props: Props });
  for (const name of REGISTER_BUTTON.split(" "))
    expect(classes).toContain(name);
  expect(classes).not.toContain("px-3");
  expect(classes).not.toContain("text-sm");
});

test("a guest's controls carry the marker the tools row closes up on", async () => {
  const marked = elements(await AccountTools()).filter(
    (element) => "data-guest-tools" in element.props,
  );
  expect(marked).toHaveLength(1);
});

test("the header's tools row closes up below md only where the guest marker is", () => {
  const row = elements(SiteHeader()).find((element) =>
    classesOf(element).includes("ml-auto"),
  );
  expect(row).toBeDefined();
  expect(classesOf(row as { props: Props })).toEqual(HEADER_TOOLS.split(" "));
  const classes = HEADER_TOOLS.split(" ");
  // The usual gaps stay for every other header; the closer one needs the guest marker.
  expect(classes).toContain("gap-1");
  expect(classes).toContain("md:gap-2");
  expect(classes).toContain("max-md:has-[[data-guest-tools]]:gap-0.5");
});
