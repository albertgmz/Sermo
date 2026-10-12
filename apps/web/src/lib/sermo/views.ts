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
  /** The title to show under or beside the name. */
  title: string;
  /**
   * Group badges, highest group first (staff role, paid rank, donor, ...). `style` is a key
   * from the design system's list of badge styles; an unknown or empty key draws the default.
   */
  badges: { label: string; color: string | null; style: string }[];
  level: number;
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
