import {
  expect,
  expectFits,
  MEMBER_STATE,
  PEER,
  phoneWidth,
  ready,
  test,
  visit,
} from "./fixtures";

test.use({ storageState: MEMBER_STATE });

test("the search page filters by a member picked from suggestions, and its labels focus their fields @all", async ({
  page,
}) => {
  await visit(page, "/search");
  await ready(page);

  // Pressing a label focuses its field.
  await page.getByText("Forum", { exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Forum" })).toBeFocused();
  await page.getByText("By member", { exact: true }).click();
  await expect(
    page.getByRole("searchbox", { name: "By member" }),
  ).toBeFocused();

  await page
    .getByRole("searchbox", { name: "By member" })
    .fill(PEER.slice(0, 2));
  await page.getByRole("button", { name: PEER, exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Remove ${PEER}` }),
  ).toBeVisible();
  await expectFits(page, "search with a member");

  await page.getByRole("searchbox", { name: "Keywords" }).fill("the");
  await page
    .getByRole("search")
    .getByRole("button", { name: "Search", exact: true })
    .click();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("author") === PEER,
  );
  // The member stays chosen on the results.
  await expect(
    page.getByRole("button", { name: `Remove ${PEER}` }),
  ).toBeVisible();
});

test("the header search finds a member too", async ({ page }) => {
  test.skip(
    phoneWidth(page),
    "on a phone the header's search is a link to the search page, tested above",
  );
  await visit(page, "/");
  await ready(page);
  await page.getByRole("button", { name: "Search" }).first().click();
  const panel = page.getByRole("dialog");
  await panel
    .getByRole("searchbox", { name: "By member" })
    .fill(PEER.slice(0, 2));
  await panel.getByRole("button", { name: PEER, exact: true }).click();
  await panel
    .getByRole("searchbox", { name: "Search", exact: true })
    .fill("the");
  await panel.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/search" && url.searchParams.get("author") === PEER,
  );
});
