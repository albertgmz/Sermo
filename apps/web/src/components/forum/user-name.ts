import type { CSSProperties } from "react";
import { isHexColor } from "@/lib/css-color";
import type { MemberView } from "@/lib/sermo/views";

// The colour reaches the name as a custom property read by one utility class;
// a member with no colour, or one that is not #rrggbb, gets neither, so the name keeps the text
// colour.
export function userNameProps(user: Pick<MemberView, "nameColor">): {
  className?: string;
  style?: CSSProperties;
} {
  if (!isHexColor(user.nameColor)) return {};
  return {
    className: "text-(--name-color)",
    style: { "--name-color": user.nameColor } as CSSProperties,
  };
}

export const userLinkClass = "font-semibold underline-offset-4 hover:underline";
