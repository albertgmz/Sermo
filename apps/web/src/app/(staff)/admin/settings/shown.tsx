// The marker of a settings form: each row says, in a hidden field, which setting it shows. The
// action writes only the settings that were named, so a setting the form did not show (a request
// built by hand, a page older than a setting) is never read as "off" or "empty". `shownKeys` in
// ./save reads the markers back.
//
// Props
//   name  The settings key the row shows, as the action's spec names it.
export const SHOWN = "shown";

export function Shown({ name }: { name: string }) {
  return <input type="hidden" name={SHOWN} value={name} />;
}
