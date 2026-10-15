// What the reference needs of the root element: Swagger UI draws its dark look under
// `html.dark-mode`, and the site's own theme is the `dark` class on the same element.
export type ClassRoot = {
  classList: {
    contains(name: string): boolean;
    toggle(name: string, force: boolean): unknown;
    remove(name: string): unknown;
  };
};

// Puts the library's class in step with the site's. A change is made only when there is one, so
// an observer of the class list does not call this again for nothing.
export function followSiteTheme(root: ClassRoot) {
  const dark = root.classList.contains("dark");
  if (root.classList.contains("dark-mode") !== dark) {
    root.classList.toggle("dark-mode", dark);
  }
}

// Leaves nothing behind: the library's rule for `html.dark-mode` would otherwise colour every
// later page, whatever the site's theme.
export function releaseSiteTheme(root: ClassRoot) {
  root.classList.remove("dark-mode");
}
