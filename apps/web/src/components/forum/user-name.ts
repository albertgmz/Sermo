import type { CSSProperties } from "react";
import { isHexColor } from "@/lib/css-color";
import type { MemberView } from "@/lib/sermo/views";

// The colour reaches the name as a custom property read by the .ink class (globals.css), which keeps it readable in the theme;
// a member with no colour, or one that is not #rrggbb, gets neither, so the name keeps the text
// colour.
export function userNameProps(user: Pick<MemberView, "nameColor">): {
  className?: string;
  style?: CSSProperties;
} {
  if (!isHexColor(user.nameColor)) return {};
  return {
    className: "ink",
    style: { "--ink": user.nameColor } as CSSProperties,
  };
}

export const userLinkClass = "font-semibold underline-offset-4 hover:underline";
