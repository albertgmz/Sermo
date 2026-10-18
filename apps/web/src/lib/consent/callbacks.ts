import type { CookieConsentConfig } from "vanilla-cookieconsent";
import { effectOf, firstChoiceEffect } from "./effects";
import type { OptionalCategory } from "./inventory";
import { GPC_MARK } from "./state";

// Whether the page must be loaded again because the visitor went from "not asked" to "asked" (a
// guest outside Europe signed in by a soft navigation): the running banner started in opt-out mode,
// never shows itself and has every category on, so only a fresh start asks the member.
export const mustReloadForQuiet = (was: boolean, now: boolean) => was && !now;

type Library = {
  getUserPreferences(): { acceptedCategories: string[] };
  setCookieData(data: { value: unknown; mode?: "update" }): boolean;
};

// What the banner does when the visitor chooses: send the choice to be saved on the account, mark it
// as made under Global Privacy Control when the browser sends the signal (so the server lets it
// stand), then reload or refresh the page as `effects` says. `library` is the started banner library, or null
// when it could not start (the choice was still stored by it, and is still sent).
export function consentCallbacks({
  quiet,
  gpc = false,
  omit,
  library,
  save,
  reload,
  refresh,
  later = (run) => setTimeout(run, 0),
}: {
  // The banner is not shown to this visitor (the library runs in its opt-out mode).
  quiet: boolean;
  // The browser sends Global Privacy Control: a quiet visitor then starts with nothing on, in the
  // library's opt-in mode, as any other visitor (see `consentConfig`).
  gpc?: boolean;
  // Categories the banner does not offer.
  omit: readonly OptionalCategory[];
  library: () => Promise<Library | null> | null;
  save: () => void;
  reload: () => void;
  refresh: () => void;
  later?: (run: () => void) => void;
}): Pick<CookieConsentConfig, "onFirstConsent" | "onChange"> {
  const allOn = quiet && !gpc;
  const mark = (started: Library) => {
    if (gpc) started.setCookieData({ value: GPC_MARK, mode: "update" });
  };
  const act = (effect: "reload" | "refresh" | "none") => {
    if (effect === "reload") reload();
    else if (effect === "refresh") refresh();
  };
  // In the library's opt-out mode, which a quiet visitor without the signal is in, the first choice reports a change
  // as well, in the same call, when some category differs from what was on before: that one is
  // the first choice again, not a second event.
  let justChosen = false;
  return {
    onFirstConsent: async () => {
      if (allOn) {
        justChosen = true;
        later(() => {
          justChosen = false;
        });
      }
      save();
      const started = await library();
      if (!started) return;
      mark(started);
      act(
        firstChoiceEffect(
          allOn,
          started.getUserPreferences().acceptedCategories,
          omit,
        ),
      );
    },
    onChange: async ({ changedCategories }) => {
      if (justChosen) return;
      save();
      const started = await library();
      if (!started) return;
      mark(started);
      act(
        effectOf(
          changedCategories,
          started.getUserPreferences().acceptedCategories,
        ),
      );
    },
  };
}
