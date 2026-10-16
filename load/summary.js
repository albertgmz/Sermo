import { OPS } from "./lib.js";

// k6 keeps the per-metric numbers under `values` (older shape) or directly on the metric.
function values(metric) {
  return metric ? metric.values || metric : null;
}

function ms(value) {
  return value === undefined ? "-" : value.toFixed(1);
}

function row(label, trend) {
  const v = values(trend);
  if (!v) return null;
  return [label, v.count, ms(v.avg), ms(v["p(95)"]), ms(v["p(99)"]), ms(v.max)];
}

function table(rows) {
  const head = ["", "requests", "avg ms", "p95 ms", "p99 ms", "max ms"];
  const all = [head, ...rows.filter(Boolean)];
  const widths = head.map((_, i) => Math.max(...all.map((r) => String(r[i]).length)));
  return all
    .map((r) =>
      r.map((cell, i) => String(cell)[i === 0 ? "padEnd" : "padStart"](widths[i])).join("  "),
    )
    .join("\n");
}

function percent(rate) {
  return rate === undefined ? "-" : `${(rate * 100).toFixed(2)}%`;
}

export function handleSummary(data) {
  const m = data.metrics;
  const duration = (name) => m[`http_req_duration{${name}}`];
  const reads = values(duration("kind:read"));
  const writes = values(duration("kind:write"));
  const total = values(m.http_reqs);
  const share = reads && writes && total ? (writes.count / (reads.count + writes.count)) * 100 : 0;
  const failed = (kind) => percent(values(m[`http_req_failed{kind:${kind}}`])?.rate);
  const failedAll = percent(values(m.http_req_failed)?.rate);
  const thresholds = Object.entries(m)
    .flatMap(([name, metric]) =>
      Object.entries(metric.thresholds || {})
        .filter(([rule]) => rule !== "max>=0")
        .map(([rule, result]) => `${result.ok ? "pass" : "FAIL"}  ${name}  ${rule}`),
    )
    .join("\n");
  const text = [
    "",
    `Load test report (${__ENV.PROFILE || "smoke"}, ${Math.round(data.state.testRunDurationMs / 1000)} s)`,
    "",
    table([
      row("reads", duration("kind:read")),
      row("writes", duration("kind:write")),
      ...OPS.map((op) => row(op, duration(`name:${op}`))),
    ]),
    "",
    `requests: ${total ? total.count : 0} (${total ? total.rate.toFixed(1) : 0}/s), writes ${share.toFixed(1)}% of reads and writes`,
    `http errors: reads ${failed("read")}, writes ${failed("write")}, all requests ${failedAll}`,
    `peak VUs: ${values(m.vus_max)?.max ?? values(m.vus)?.max ?? "-"}`,
    "",
    "Thresholds (an initial report bar, not a budget):",
    thresholds,
    "",
  ].join("\n");
  const out = __ENV.SUMMARY_OUT;
  return out ? { stdout: text, [out]: JSON.stringify(data, null, 2) } : { stdout: text };
}
