import { type PictureRef, withPicture } from "@/components/forum/picture-ref";

// What the viewer needs of the browser, as functions so that nothing is read before it is used (the
// viewer is drawn on the server too).
export type HistoryEnv = {
  history: () => Pick<History, "pushState" | "replaceState" | "back">;
  // The address the browser is at: path, search and hash.
  here: () => string;
};

// Which picture is open lives in the address (`?picture=`), so that a link opens it and Back
// closes it. Opening adds a history entry; stepping to the next picture replaces it, so one Back
// leaves the viewer however far the visitor went; closing goes back when the viewer added the
// entry (leaving none behind for the list) and otherwise (a link opened it) takes the picture out
// of the address in place.
export function pictureHistory(env: HistoryEnv) {
  let pushed = false;
  return {
    open(ref: PictureRef) {
      env.history().pushState(null, "", withPicture(env.here(), ref));
      pushed = true;
    },
    change(ref: PictureRef) {
      env.history().replaceState(null, "", withPicture(env.here(), ref));
    },
    close() {
      if (pushed) {
        pushed = false;
        env.history().back();
      } else {
        env.history().replaceState(null, "", withPicture(env.here(), null));
      }
    },
    // The address no longer holds a picture (Back was pressed): the entry is gone.
    left() {
      pushed = false;
    },
  };
}
