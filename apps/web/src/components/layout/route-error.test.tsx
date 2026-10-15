import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import {
  APPROVAL_PENDING_DIGEST,
  RATE_LIMITED_DIGEST,
} from "@/lib/sermo/errors";
import { withIntl } from "@/lib/test-intl";
import { RouteError } from "./route-error";

const draw = (digest?: string) =>
  renderToStaticMarkup(
    withIntl(
      <RouteError
        error={Object.assign(new Error("x"), { digest })}
        retry={() => {}}
      />,
    ),
  );

const e = messages.layout.routeError;

test("a page an account waiting for approval was refused says so and offers no retry", () => {
  const html = draw(APPROVAL_PENDING_DIGEST);
  expect(html).toContain(e.approvalTitle);
  expect(html).toContain(e.approvalDescription);
  expect(html).not.toContain(e.retry);
  expect(html).toContain(e.home);
});

test("the throttled and the plain failure keep their words and their retry", () => {
  const throttled = draw(RATE_LIMITED_DIGEST);
  expect(throttled).toContain(e.throttledTitle);
  expect(throttled).toContain(e.retry);
  const plain = draw("anything else");
  expect(plain).toContain(e.title);
  expect(plain).toContain(e.retry);
  expect(draw()).toContain(e.title);
});
