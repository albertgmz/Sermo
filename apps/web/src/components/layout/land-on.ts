import { HASH_LINK_EVENT } from "@/components/layout/spotlight";

// Lands on an item of the page just written or edited (`#profile-comment-5`), as a link to it
// would: the address takes its hash in place of the current entry's (a write is not a step to go
// back over), and `HashTarget` lands on the item once it is drawn. The state passed is null so
// Next's router takes the new address in (it skips a state of its own), or its next commit, after
// the write's refresh, puts the old one back.
export function landOn(hash: string) {
  if (hash !== window.location.hash) {
    const url = new URL(window.location.href);
    url.hash = hash;
    window.history.replaceState(null, "", url);
  }
  window.dispatchEvent(new CustomEvent(HASH_LINK_EVENT, { detail: hash }));
}
