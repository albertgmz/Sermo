import { expect, test } from "bun:test";
import { IntlProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { Credits } from "@/components/forum/credits";
import { messages } from "@/i18n/messages";

const draw = (locale: "en" | "es", value: number) =>
  renderToStaticMarkup(
    <IntlProvider locale={locale} messages={messages} timeZone="UTC">
      <Credits value={value} />
    </IntlProvider>,
  );

test("a price of four digits is grouped in Spanish and in English", () => {
  expect(draw("es", 2300)).toContain("2.300");
  expect(draw("en", 2300)).toContain("2,300");
});
