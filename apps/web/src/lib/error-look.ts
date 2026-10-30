// How the page that stands without the layout (`app/global-error.tsx`) is drawn: in the language
// the visitor chose (their language cookie; Spanish when there is none) and in the colour theme
// they chose (the stored theme choice: dark, or system following the device; light when they
// chose nothing). Pure, so it is decided from what the browser holds.
export type ErrorLook = { language: "en" | "es"; dark: boolean };

export function errorLook(
  localeCookie: string | undefined,
  themeChoice: string | null,
  deviceIsDark: boolean,
): ErrorLook {
  return {
    language: /^en($|[-_])/i.test(localeCookie ?? "") ? "en" : "es",
    dark: themeChoice === "dark" || (themeChoice === "system" && deviceIsDark),
  };
}
