"use client";

import { createContext, use } from "react";

// A post that is edited where it is read, as XenForo's quick edit: the Edit of its bar opens the
// editor in place of its text instead of going to the edit page, which stays the link's address
// (without JavaScript, and for a new tab). Given by the post (`PostEditScope` in a thread).
export type InPlaceEditing = {
  editing: boolean;
  open: () => void;
  // Fetches the editor's code ahead of the press: a pointer over Edit, or the focus on it.
  warm: () => void;
  // Edit, which takes the focus back when the editor closes.
  trigger: React.RefObject<HTMLAnchorElement | null>;
};

export const InPlaceEdit = createContext<InPlaceEditing | null>(null);

// What a post shows only while it is not being edited in place (its signature): the editor takes
// the whole message, as XenForo's does.
export function HiddenWhileEditing({
  children,
}: {
  children: React.ReactNode;
}) {
  return use(InPlaceEdit)?.editing ? null : children;
}
