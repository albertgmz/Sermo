import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PromptCard } from "@/components/layout/prompt-card";

const card = (inline?: boolean) =>
  renderToStaticMarkup(
    <PromptCard
      inline={inline}
      icon={null}
      title="Install"
      action={{ label: "Install", onClick: () => {} }}
      dismiss={{ label: "Not now", onClick: () => {} }}
    >
      Body
    </PromptCard>,
  );

test("the card floats at the foot of the screen unless it is set in the page", () => {
  expect(card()).toContain("fixed");
  expect(card()).toContain("data-prompt-card");
  const inline = card(true);
  expect(inline).not.toContain("fixed");
  expect(inline).toContain("data-prompt-card");
  expect(inline).toContain("Not now");
});
