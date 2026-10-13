// The mark of a site that has not uploaded an icon: the drawn mark of `Logo`, as percent-encoded
// SVG text so that no file is served for it. `SiteIcon` hands the data URL to the page; the
// browser's request for /favicon.ico is answered with the decoded text (app/favicon.ico/route.ts).
const ENCODED =
  "%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20width%3D%2224%22%20height%3D%2224%22%20fill%3D%22none%22%20stroke%3D%22%23dc2626%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%3E%3Cpath%20d%3D%22M5%2019%2015%205%22%2F%3E%3Cpath%20d%3D%22M13%2019l6-8%22%2F%3E%3C%2Fsvg%3E";

export const DEFAULT_ICON_URL = `data:image/svg+xml,${ENCODED}`;

export const defaultIconSvg = () => decodeURIComponent(ENCODED);
