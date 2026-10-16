// While the cookie banner is up it covers the bottom of the screen, and a button at the end of a
// page (the sign-in form's) would stay under it. The page keeps as much room under its content as
// the banner is tall (`--consent-space`, read by `globals.css` while the library marks the page
// with `show--consent`), so the content can be scrolled clear of it. Returns the function that
// gives the room back.
type Watch = (run: () => void) => {
  observe(target: Element): void;
  disconnect(): void;
};

export function reserveBannerSpace(
  root: Pick<HTMLElement, "style">,
  banner: Pick<Element, "getBoundingClientRect">,
  watch: Watch = (run) => new ResizeObserver(run),
) {
  const set = () =>
    root.style.setProperty(
      "--consent-space",
      `${banner.getBoundingClientRect().height}px`,
    );
  set();
  // The banner's height follows the width and the language.
  const observer = watch(set);
  observer.observe(banner as Element);
  return () => {
    observer.disconnect();
    root.style.removeProperty("--consent-space");
  };
}
