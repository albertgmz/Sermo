import { type PictureRef, withPicture } from "@/components/forum/picture-ref";

// What the viewer needs of the browser, as functions so that nothing is read before it is used (the
// viewer is drawn on the server too).
export type HistoryEnv = {
  history: () => Pick<History, "pushState" | "replaceState" | "back" | "state">;
  // The address the browser is at: path, search and hash.
  here: () => string;
};

// What the viewer writes into the state of the history entry it adds, so that the entry is told
// from one a link made, even after the page was left and came back.
const OWN = { sermoPicture: true } as const;

function isOwn(state: unknown) {
  return (
    typeof state === "object" &&
    state !== null &&
    (state as Record<string, unknown>).sermoPicture === true
  );
}

// Which picture is open lives in the address (`?picture=`), so that a link opens it and Back
// closes it. Opening adds a history entry marked as the viewer's own; stepping to the next picture
// replaces it (keeping the mark), so one Back leaves the viewer however far the visitor went;
// closing goes back when the entry the browser is on is the viewer's own (leaving none behind for
// the list, also after a visit to the post and Back) and otherwise (a link opened it) takes the
// picture out of the address in place.
export function pictureHistory(env: HistoryEnv) {
  return {
    open(ref: PictureRef) {
      env.history().pushState(OWN, "", withPicture(env.here(), ref));
    },
    change(ref: PictureRef) {
      const history = env.history();
      history.replaceState(
        isOwn(history.state) ? OWN : null,
        "",
        withPicture(env.here(), ref),
      );
    },
    close() {
      const history = env.history();
      if (isOwn(history.state)) history.back();
      else history.replaceState(null, "", withPicture(env.here(), null));
    },
  };
}
