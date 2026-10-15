// What the editor's form sends. The editor writes BB code its own way (it puts a blank line
// between blocks, one tag spelling, no space at the edges), so the text it opened with is sent as
// it was given until the editor's text differs from what it wrote for that text at the start: only
// a real change is a change, and saving an edit the member did not touch changes nothing.
//
// `next` is what the editor writes now, `baseline` what it wrote for the text it opened with (its
// first report) and `original` the text it opened with, if it opened with one.
export function sentText(
  next: string,
  baseline: string,
  original: string | undefined,
) {
  return next === baseline ? (original ?? next) : next;
}
