import { createContext, type RefObject } from "react";

// The BB code source field the editor shows in place of its rich text. `active` says whether it is
// shown; the rest is for what the rest of the composer asks of the text (a quote, an attachment's
// tag), which goes to the field while it is the one showing.
export type SourceMode = {
  active: boolean;
  field: RefObject<HTMLTextAreaElement | null>;
  // The text of the field changed.
  commit: (text: string) => void;
  toggle: () => void;
};

export const SourceContext = createContext<SourceMode | null>(null);
