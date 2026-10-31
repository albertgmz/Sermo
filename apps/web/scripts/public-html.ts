import {
  firstHtmlArticle,
  firstHtmlProblem,
  PUBLIC_TEXT_PATHS,
} from "./public-html-lib";

// Usage: bun scripts/public-html.ts <site address> [more paths]
// Asks the running site for each public page that holds fixed text (and for the extra paths, for
// example /pages/about), as a reader without JavaScript does, and exits 1 when a page's text is not
// in its first HTML: missing, or only inside a streamed `<div hidden>` block. Each page is asked
// twice: the first answer may come before the page's shared read is cached, the second must pass.

const [base, ...extra] = process.argv.slice(2);
if (!base) {
  console.error(
    "public-html: give the site address, e.g. http://localhost:4400",
  );
  process.exit(1);
}

async function fetchHtml(
  path: string,
): Promise<{ status: number; html: string }> {
  const response = await fetch(new URL(path, base), {
    headers: { accept: "text/html", "user-agent": "curl/8.0" },
    redirect: "manual",
  });
  return { status: response.status, html: await response.text() };
}

let failed = 0;
for (const path of [...PUBLIC_TEXT_PATHS, ...extra]) {
  const first = await fetchHtml(path);
  const second = await fetchHtml(path);
  const problem =
    second.status === 200
      ? firstHtmlProblem(second.html)
      : `answered ${second.status}`;
  const coldProblem =
    first.status === 200 ? firstHtmlProblem(first.html) : null;
  const article = firstHtmlArticle(second.html);
  if (problem) {
    failed += 1;
    console.log(`FAIL ${path}: ${problem}`);
  } else {
    console.log(
      `ok   ${path}: "${article?.heading}", ${article?.text.length} characters${coldProblem ? ` (first answer: ${coldProblem})` : ""}`,
    );
  }
}
process.exit(failed > 0 ? 1 : 0);
