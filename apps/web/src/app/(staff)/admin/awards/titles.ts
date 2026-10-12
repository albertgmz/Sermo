import { phraseTitle } from "../groups/phrases";

// What to call a criterion an award can be given for. `awards.criteria` returns a phrase key
// ("promotion.criterion.post_count") and the phrase catalogue is not reachable from the web app,
// so this shows the words of the key. When the backend returns a resolved title, this is the one
// place to switch to it.
export const criterionTitle = (label: string) =>
  phraseTitle(label, "promotion.criterion.");
