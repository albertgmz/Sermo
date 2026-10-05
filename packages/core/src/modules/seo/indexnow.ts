import { requireBaseURL } from "./paths";

export interface IndexNowBatch {
  endpoint: string;
  body: { host: string; key: string; keyLocation: string; urlList: string[] };
}

export function indexNowBatches(
  baseURL: string,
  key: string | undefined,
  urls: readonly string[],
  endpoint = "https://api.indexnow.org/indexnow",
): IndexNowBatch[] {
  if (!key) return [];
  const origin = requireBaseURL(baseURL);
  const unique = [...new Set(urls.map((value) => new URL(value, origin).href))].filter(
    (value) => new URL(value).origin === origin.origin,
  );
  const batches: IndexNowBatch[] = [];
  for (let start = 0; start < unique.length; start += 10_000)
    batches.push({
      endpoint,
      body: {
        host: origin.host,
        key,
        keyLocation: new URL(`/${key}.txt`, origin).href,
        urlList: unique.slice(start, start + 10_000),
      },
    });
  return batches;
}

/** The caller's durable job retries non-successful sends. An absent key is a no-op. */
export async function sendIndexNow(
  batches: readonly IndexNowBatch[],
  fetcher: typeof fetch = fetch,
): Promise<void> {
  for (const batch of batches) {
    const response = await fetcher(batch.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(batch.body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`IndexNow request failed: ${response.status}`);
  }
}
