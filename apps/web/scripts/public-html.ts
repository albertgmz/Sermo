import {
  firstHtmlArticle,
  firstHtmlProblem,
  PUBLIC_TEXT_PATHS,
} from "./public-html-lib";

// Usage: bun scripts/public-html.ts <site address> [more paths]
// Asks the running site for each public page that holds fixed text (and for the extra paths, for
// example /pages/about), as a reader without JavaScript does, and exits 1 when a page's text is not
// in its first HTML: missing, or only inside a streamed `<div hidden>` block. Each page is asked
// twice, and both answers must pass: the first one is read before the page's text is cached.

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

// Why the answer fails, or null.
function problemOf(answer: { status: number; html: string }): string | null {
  return answer.status === 200
    ? firstHtmlProblem(answer.html)
    : `answered ${answer.status}`;
}

let failed = 0;
for (const path of [...PUBLIC_TEXT_PATHS, ...extra]) {
  for (const round of ["first", "second"]) {
    const answer = await fetchHtml(path);
    const problem = problemOf(answer);
    const article = firstHtmlArticle(answer.html);
    if (problem) failed += 1;
    console.log(
      problem
        ? `FAIL ${path} (${round} answer): ${problem}`
        : `ok   ${path} (${round} answer): "${article?.heading}", ${article?.text.length} characters`,
    );
  }
}
process.exit(failed > 0 ? 1 : 0);
