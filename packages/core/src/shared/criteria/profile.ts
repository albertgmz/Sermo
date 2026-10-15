import { flag, withValue } from "./build";
import { DAY, type Spec } from "./types";

/**
 * How a member has set up their profile. All of it sits on the member's own row, so every one is
 * cheap; a profile edit tells the consumers (`content.edited` on a profile).
 */
export const profileSpecs: readonly Spec[] = [
  flag("has_cover", (f) => f.hasCover),
  flag("has_name_color", (f) => f.hasNameColor),
  flag("has_accent_color", (f) => f.hasAccentColor),
  flag("has_frame", (f) => f.hasFrame),
  // Of Discord, Telegram and X, so at most 3.
  withValue(
    "social_links_at_least",
    "atLeast",
    "count",
    "member",
    (f, v) => f.socialLinkCount >= v,
  ),
  // An avatar, an about text, a location and a birthday.
  flag("profile_complete", (f) => f.profileComplete),
  withValue(
    "username_changed_within_days",
    "atMost",
    "days",
    "member",
    (f, v) => f.usernameChangedAt !== null && f.now - f.usernameChangedAt <= v * DAY,
  ),
];
