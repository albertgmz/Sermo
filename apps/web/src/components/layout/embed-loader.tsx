"use client";

import { useEffect } from "react";
import { consentLibrary } from "@/components/layout/consent-library";
import { EMBED_ALLOW, EMBED_SANDBOX, embedSource } from "@/lib/consent/embeds";

// Puts the player in the place of a placeholder (`gateEmbeds`). The address is checked again
// against the allowed hosts: the placeholder is only data.
function load(placeholder: HTMLElement) {
  const src = embedSource(placeholder.dataset.embedSrc);
  if (!src) return;
  const shape = ["audio", "post"].includes(placeholder.dataset.embedShape ?? "")
    ? placeholder.dataset.embedShape
    : "video";
  const frame = document.createElement("iframe");
  frame.className = `bb-media bb-media-${shape}`;
  frame.src = src;
  frame.loading = "lazy";
  frame.setAttribute("sandbox", EMBED_SANDBOX);
  frame.allow = EMBED_ALLOW[shape === "audio" ? "audio" : "video"];
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  frame.allowFullscreen = true;
  placeholder.replaceWith(frame);
}

// Handles the two buttons of a placeholder, wherever it is on the page (delegated: the HTML comes
// from the server, and a revealed spoiler brings more of it). "Load" loads that one player;
// "Always load embedded content" accepts the embeds category: the refresh it causes draws them all. Renders nothing.
export function EmbedLoader() {
  useEffect(() => {
    const onClick = async (event: MouseEvent) => {
      const target = event.target as Element | null;
      const button = target?.closest<HTMLElement>(
        "[data-embed-load], [data-embed-always]",
      );
      const placeholder = button?.closest<HTMLElement>(".bb-embed");
      if (!button || !placeholder) return;
      event.preventDefault();
      if (button.hasAttribute("data-embed-load")) {
        load(placeholder);
        return;
      }
      // Without a running banner nothing can be recorded, so only this player is loaded.
      const library = await consentLibrary();
      if (!library) {
        load(placeholder);
        return;
      }
      const accepted = library.getUserPreferences().acceptedCategories;
      library.acceptCategory([...new Set([...accepted, "embeds"])]);
      // The choice refreshes the page, which makes the server draw the players it placed. A
      // revealed spoiler was inserted here, so no refresh reaches it: load those now.
      for (const other of document.querySelectorAll<HTMLElement>(
        ".bb-spoiler-open .bb-embed",
      ))
        load(other);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}
