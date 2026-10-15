"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { pictureHistory } from "@/components/forum/picture-history";
import {
  mergeEntries,
  PICTURE_PARAM,
  type PictureRef,
  parseRef,
} from "@/components/forum/picture-ref";
import type { PictureEntry } from "@/components/forum/picture-types";

// The viewer's code (the dialog and the reactions with it) comes when a picture is opened, not
// with the list.
const PictureLightbox = dynamic(
  () => import("@/components/forum/picture-lightbox"),
  { ssr: false },
);

type Viewer = {
  // The pictures a list drew, for the viewer to step through. They are kept when a row scrolls out
  // of a long list.
  register: (entries: PictureEntry[]) => void;
  open: (ref: PictureRef) => void;
};

const ViewerContext = createContext<Viewer | null>(null);

// Null outside a `PictureViewer`: a picture is then a plain link.
export const usePictureViewer = () => useContext(ViewerContext);

const BROWSER = {
  history: () => window.history,
  here: () => `${location.pathname}${location.search}${location.hash}`,
};

// Holds the pictures of a list and the viewer over it. Which picture is open is in the address
// (`?picture=`): opening one adds a history entry, stepping to the next replaces it, so Back closes
// the viewer in one press and a link opens it. The list's own address (tab, pages) is kept.
export function PictureViewer({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<PictureEntry[]>([]);
  const current = parseRef(useSearchParams().get(PICTURE_PARAM));
  const [history] = useState(() => pictureHistory(BROWSER));
  useEffect(() => {
    if (!current) history.left();
  }, [current, history]);

  const register = useCallback(
    (added: PictureEntry[]) => setEntries((held) => mergeEntries(held, added)),
    [],
  );
  const viewer = useMemo(
    () => ({ register, open: history.open }),
    [register, history],
  );

  return (
    <ViewerContext value={viewer}>
      {children}
      {current && (
        <PictureLightbox
          current={current}
          entries={entries}
          onChange={history.change}
          onClose={history.close}
        />
      )}
    </ViewerContext>
  );
}
