export interface SpamSubmission {
  ip: string;
  email?: string;
  username?: string;
  body?: string;
  userAgent?: string;
  kind?: "forum-post" | "reply" | "message" | "signup";
}
export interface SpamVerdict {
  spam: boolean;
  source: "disabled" | "stopforumspam" | "akismet";
}
export interface SpamChecker {
  check(submission: SpamSubmission): Promise<SpamVerdict>;
}
export type SpamFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export const disabledSpamChecker: SpamChecker = {
  async check() {
    return { spam: false, source: "disabled" };
  },
};

export function stopForumSpamChecker(fetcher: SpamFetch = fetch): SpamChecker {
  return {
    async check(submission) {
      const url = new URL("https://api.stopforumspam.org/api");
      url.searchParams.set("f", "json");
      url.searchParams.set("ip", submission.ip);
      if (submission.email) url.searchParams.set("email", submission.email);
      if (submission.username) url.searchParams.set("username", submission.username);
      const response = await fetcher(url);
      if (!response.ok) throw new Error(`StopForumSpam returned ${response.status}`);
      const result: unknown = await response.json();
      if (!result || typeof result !== "object") throw new Error("Invalid StopForumSpam response");
      const data = result as Record<string, unknown>;
      const listed = (key: string) => {
        const item = data[key];
        return (
          item != null &&
          typeof item === "object" &&
          (item as Record<string, unknown>).appears === 1
        );
      };
      return {
        spam: listed("ip") || listed("email") || listed("username"),
        source: "stopforumspam",
      };
    },
  };
}

/** Akismet's documented comment-check endpoint; caller provides an injectable fetch. */
export function akismetChecker(
  apiKey: string,
  siteUrl: string,
  fetcher: SpamFetch = fetch,
): SpamChecker {
  return {
    async check(submission) {
      const body = new URLSearchParams({
        api_key: apiKey,
        blog: siteUrl,
        user_ip: submission.ip,
        comment_type: submission.kind ?? "forum-post",
      });
      if (submission.email) body.set("comment_author_email", submission.email);
      if (submission.username) body.set("comment_author", submission.username);
      if (submission.body) body.set("comment_content", submission.body);
      if (submission.userAgent) body.set("user_agent", submission.userAgent);
      const response = await fetcher("https://rest.akismet.com/1.1/comment-check", {
        method: "POST",
        body,
      });
      if (!response.ok) throw new Error(`Akismet returned ${response.status}`);
      const verdict = (await response.text()).trim();
      if (verdict !== "true" && verdict !== "false") throw new Error("Invalid Akismet response");
      return { spam: verdict === "true", source: "akismet" };
    },
  };
}
