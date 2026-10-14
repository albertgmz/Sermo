"use client";

import { createContext, useContext } from "react";

// Whether names and avatars below draw a member card. A postbit (beside a post, or inside the card
// itself) turns it off: the information is already there, and a card must not open another card.
const Enabled = createContext(true);

export function MemberCardScope({
  disabled,
  children,
}: {
  disabled: boolean;
  children: React.ReactNode;
}) {
  return <Enabled value={!disabled}>{children}</Enabled>;
}

export function useMemberCardsEnabled() {
  return useContext(Enabled);
}

// Set by whatever holds a loaded card. A write made from inside the card (follow, unfollow) asks
// for it to be read again once it has settled; the content kept in client state does not follow
// the page's own refresh.
const Reload = createContext<() => void>(() => {});

export const MemberCardReload = Reload;

export function useMemberCardReload() {
  return useContext(Reload);
}

// Set by whatever holds a loaded card: closes it. A link out of the card uses it.
const Close = createContext<() => void>(() => {});

export const MemberCardClose = Close;

export function useMemberCardClose() {
  return useContext(Close);
}
