import type { PictureRef } from "@/components/forum/picture-ref";
import type { ReactionsData } from "@/components/forum/reactions-view";

declare const gated: unique symbol;
// The address of a picture that LITE let through. Only `lib/sermo/media-pictures.ts` makes one, on
// the server, and it is null when the visitor blocks post pictures: the viewer draws what it is
// given and never decides, so the address of a blocked picture does not exist in the browser.
export type GatedUrl = string & { readonly [gated]: true };
// A smaller copy of a picture, let through with it (none when it is blocked).
export type GatedWidth = { url: GatedUrl; width: number };

// One picture of the media list as the viewer knows it, enough to draw it and to step to the one
// either side.
export type PictureEntry = {
  // The attachment's id: the list runs newest first by it.
  id: number;
  ref: PictureRef;
  url: GatedUrl | null;
  width: number | null;
  height: number | null;
  widths: GatedWidth[];
  // What the picture is, in words: the thread it is in, or a profile.
  label: string;
};

// What the viewer asks the server for when it opens a picture.
export type PictureDetails = {
  /** `id` is null for a guest, who has no profile. */
  author: { id: number | null; username: string };
  createdAt: string;
  // The post or the wall post the picture is attached to; `label` is the thread's title (none for
  // a wall post).
  where: { href: string; label: string | null };
  // The picture itself, for an address that names one the list does not hold.
  picture: {
    url: GatedUrl | null;
    width: number | null;
    height: number | null;
    widths: GatedWidth[];
  };
  viewerId: number | null;
  reactions: ReactionsData;
  // What a reply is: to the thread of the post, or a comment on the wall post. Null when the
  // viewer may not answer.
  reply:
    | { kind: "post"; threadId: number }
    | { kind: "wall"; profilePostId: number }
    | null;
};

export type PictureResult =
  | { status: "ready"; details: PictureDetails }
  // The post is gone, closed to the viewer, or the file is not one of its pictures.
  | { status: "gone" }
  // The backend could not be asked: trying again may work.
  | { status: "failed" };
