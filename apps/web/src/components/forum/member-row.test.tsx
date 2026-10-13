import { expect, mock, test } from "bun:test";
import type { ReactElement } from "react";

mock.module("server-only", () => ({}));
const { MemberRow } = await import("./member-row");
const { UserLink } = await import("./user-link");

const user = {
  id: 3,
  username: "ember",
  avatar: null,
  frame: null,
  nameColor: null,
  title: "Member",
  badges: [],
  level: 1,
};

// The first element of the tree whose type is `type`, looking through plain elements only.
function find(
  node: unknown,
  type: unknown,
): ReactElement<{ className?: string }> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, type);
      if (found) return found;
    }
    return null;
  }
  const element = node as ReactElement<{ children?: unknown }>;
  if (element.type === type)
    return element as ReactElement<{ className?: string }>;
  return find(element.props?.children, type);
}

test("the member name in a row has a 40px touch target that does not change the row's height", () => {
  const link = find(MemberRow({ user }), UserLink);
  expect(link?.props.className).toContain("py-2.5");
  expect(link?.props.className).toContain("-my-2.5");
});
