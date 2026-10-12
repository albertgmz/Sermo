// Adapts the JSON data to the presentation shapes in `lib/sermo/views.ts`; it
// goes away with the JSON data. `db.ts` calls it, and so do the shop previews
// that draw a frame or a name colour the member does not wear yet.
import forumMessages from "../../messages/en/forum.json";
import { FRAMES, frameSrc } from "./frames";
import {
  FALLBACK_HEX,
  NAME_COLOR_HEX,
  PREFIX_COLOR_HEX,
  STAFF_COLOR_HEX,
} from "./legacy-palette";
import type { MemberView, PrefixView } from "./sermo/views";
import type { Prefix, Rank, Role, User } from "./types";

export function nameColorHex(key: string | null | undefined): string | null {
  return (
    (key && Object.hasOwn(NAME_COLOR_HEX, key) && NAME_COLOR_HEX[key]) || null
  );
}

export const DONOR_BADGE: MemberView["badges"][number] = {
  label: forumMessages.userBadges.donor,
  color: NAME_COLOR_HEX.rose,
  style: "heart",
};

// A rank badge reads in the rank's headline name colour.
export function rankBadge(rank: Rank): MemberView["badges"][number] {
  return {
    label: rank.name,
    color: nameColorHex(rank.headline.nameColor),
    style: "outline",
  };
}

// The colour a staff role gives a name when the member picked none.
export function staffNameHex(role: Role): string | null {
  return role === "member" ? null : STAFF_COLOR_HEX[role];
}

// The frame a key draws, null for an unknown key.
export function frameView(key: string | null | undefined): MemberView["frame"] {
  const geometry = key && Object.hasOwn(FRAMES, key) ? FRAMES[key] : undefined;
  if (!key || !geometry) return null;
  return {
    url: frameSrc(key),
    placement: {
      width: geometry[0],
      left: geometry[1],
      top: geometry[2],
      scale: geometry[3],
    },
  };
}

export function prefixView(prefix: Prefix): PrefixView {
  return {
    id: prefix.id,
    label: prefix.label,
    color: PREFIX_COLOR_HEX[prefix.color] ?? FALLBACK_HEX,
    icon: prefix.icon,
  };
}

// What the UI draws for a member today, in the shape the backend will serve.
export function memberView(
  base: User,
  title: string,
  level: number,
  rank: Rank | null,
): MemberView {
  const staffColor = staffNameHex(base.role);
  const badges: MemberView["badges"] = [];
  if (base.role !== "member") {
    badges.push({
      label: forumMessages.roleBadge[base.role],
      color: staffColor,
      style: base.role === "admin" ? "solid" : "tint",
    });
  }
  if (rank) badges.push(rankBadge(rank));
  if (base.donor) badges.push(DONOR_BADGE);
  return {
    id: base.id,
    username: base.username,
    avatar: base.avatar ? { url: base.avatar, smallUrl: base.avatar } : null,
    frame: frameView(base.appearance.frame),
    nameColor: nameColorHex(base.appearance.nameColor) ?? staffColor,
    title,
    badges,
    level,
  };
}
