import { nameColor } from "@/lib/appearance";
import type { Appearance, User } from "@/lib/types";

// A name colour the member picked wins over the staff colours.
export function userNameClass(
  user: Pick<User, "role"> & {
    appearance?: Pick<Appearance, "nameColor">;
  },
) {
  const picked = nameColor(user.appearance?.nameColor);
  if (picked) return picked.text;
  if (user.role === "admin") return "text-primary";
  if (user.role === "moderator") return "text-success";
}

export const userLinkClass = "font-semibold underline-offset-4 hover:underline";
