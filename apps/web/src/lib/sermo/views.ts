import type { MemberDevice, PLACE_KINDS } from "@sermo/core/contracts";
import type * as z from "zod";

type PlaceKind = (typeof PLACE_KINDS)[number];

/** Where a frame sits around the avatar box, in percent of the box, and how far the picture shrinks. */
export type FramePlacement = {
  width: number;
  left: number;
  top: number;
  scale: number;
};

/** Everything needed to draw a member wherever their name or picture appears. */
export type MemberView = {
  id: number;
  username: string;
  /** The picture, and a small rendition for lists; null draws the initials. */
  avatar: { url: string; smallUrl: string } | null;
  frame: { url: string; placement: FramePlacement } | null;
  /** #rrggbb: the colour the member chose, else their highest group's, else null. */
  nameColor: string | null;
  /** The icon the member wears beside their name, and on which side; null for none. */
  nameIcon: { icon: string; position: "before" | "after" } | null;
  /** The title to show under or beside the name. */
  title: string;
  /**
   * Group badges, highest group first (staff role, paid rank, donor, ...). `style` is a key
   * from the design system's list of badge styles; an unknown or empty key draws the default.
   */
  badges: { label: string; color: string | null; style: string }[];
  level: number;
  /** The viewer may not open this member's profile: no facts about them are shown. */
  restricted: boolean;
  /**
   * Not a member but a guest author: `username` is the name they gave ("" when none was kept).
   * There is no profile, picture or card to open.
   */
  guest?: boolean;
};

/** The label in front of a thread title. */
export type PrefixView = {
  id: number;
  label: string;
  /** #rrggbb */
  color: string;
  /** interface icon key; may be empty */
  icon: string;
};

/** A picture served by the backend or, until then, a file under /public. */
export type PictureView = { url: string };

/** A member as the author of content: the card plus what is drawn around a post. */
export type AuthorView = {
  member: MemberView;
  cover: PictureView | null;
  joinedAt: string;
  postCount: number;
  reactionScore: number;
  /** XP of the awards held and the bounds of the current level, for the progress bar. */
  xp: number;
  currentLevelXp: number;
  nextLevelXp: number;
  awards: {
    id: number;
    name: string;
    icon: string;
    tier: "bronze" | "silver" | "gold" | "legendary";
  }[];
  signatureHtml: string | null;
  /** When the member was last active, if the viewer may know; `hidden` when the member hides it. */
  lastActivity: ActivityView | null;
  /** The device of the member's latest sign-in; null when none is known. */
  device: DeviceView | null;
};

/** What a member signs in from: the kind of device and the names of its system and browser. */
export type DeviceView = z.output<typeof MemberDevice>;

/** The page a visitor last viewed, as the viewer may know it (`users.activity`). */
export type PlaceView = {
  kind: PlaceKind;
  /** The forum, thread or member, named only when the viewer may see it. */
  target: { id: number; title: string } | null;
};

/** When a visitor was last seen and, within the last hour, where. */
export type ActivityView = {
  at: string;
  /** The member hides their online status; shown to themselves and to staff. */
  hidden: boolean;
  place: PlaceView | null;
};
