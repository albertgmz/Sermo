import { phraseTitle } from "../groups/phrases";

// What to call a permission a shop item can sell. `permissions.definitions` returns a phrase key
// ("permission.forum.viewLog") and the phrase catalogue is not reachable from the web app, so
// this shows the words of the key. When the backend returns a resolved title, this is the one
// place to switch to it.
export const permissionTitle = (label: string) =>
  phraseTitle(label, "permission.");
