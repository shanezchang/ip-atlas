import { test, expect, type Page } from "./fixtures";

// Measure rendered text, not GeoJSON anchors: fonts and translations change its size.
async function labelLayout(page: Page) {
  return page.evaluate(() => {
    const map = document.querySelector("#map")!.getBoundingClientRect();
    const overlaps = (a: DOMRect, b: DOMRect) =>
      a.left < b.right + 4 &&
      a.right + 4 > b.left &&
      a.top < b.bottom + 4 &&
      a.bottom + 4 > b.top;
    const labels = Array.from(
      document.querySelectorAll<HTMLElement>(".country-label"),
    )
      .filter((el) => {
        const style = getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden";
      })
      .map((el) => ({ name: el.textContent!, box: el.getBoundingClientRect() }))
      .filter(
        ({ box }) =>
          box.right > map.left &&
          box.left < map.right &&
          box.bottom > map.top &&
          box.top < map.bottom,
      );
    const obstacles = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".rail, .map-heading, .map-controls, .map-footer, .map-pin, .pin-label",
      ),
    )
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width && r.height);
    const issues: string[] = [];
    for (const [i, { name, box }] of labels.entries()) {
      if (
        box.left < map.left + 4 ||
        box.right > map.right - 4 ||
        box.top < map.top + 4 ||
        box.bottom > map.bottom - 4
      )
        issues.push(`clipped: ${name}`);
      if (obstacles.some((r) => overlaps(box, r)))
        issues.push(`covered: ${name}`);
      for (const other of labels.slice(i + 1))
        if (overlaps(box, other.box))
          issues.push(`collision: ${name} / ${other.name}`);
    }
    return { issues, names: labels.map((x) => x.name) };
  });
}
async function readableLabels(page: Page, minimum = 1) {
  await expect.poll(async () => (await labelLayout(page)).issues).toEqual([]);
  expect((await labelLayout(page)).names.length).toBeGreaterThanOrEqual(
    minimum,
  );
}

for (const width of [1440, 390, 320])
  for (const theme of ["light", "dark"] as const)
    test(`default labels are readable at ${width}px in ${theme}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/");
      await expect(page.locator("#map")).toHaveAttribute("data-ready", "true");
      await page.evaluate(() => document.fonts.ready);
      await readableLabels(page, width > 700 ? 10 : 3);
      await page.getByRole("button", { name: "切换到中文" }).click();
      await readableLabels(page, width > 700 ? 10 : 3);
      await page.getByRole("button", { name: "Switch to English" }).click();
      await readableLabels(page, width > 700 ? 10 : 3);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
      await info.attach("label-layout", {
        body: JSON.stringify(await labelLayout(page)),
        contentType: "application/json",
      });
    });

test("label placement follows zoom, keyboard pan, pins, and viewport resize", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator("#map")).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => document.fonts.ready);
  await page.locator("#zoom-in").click();
  await readableLabels(page);
  const before = (await labelLayout(page)).names;
  await page.locator(".maplibregl-canvas").focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  await readableLabels(page);
  expect((await labelLayout(page)).names).not.toEqual(before);
  await page.getByRole("button", { name: "California", exact: false }).click();
  await expect(page.locator(".pin-label")).toHaveText("California");
  // A state-level view can legitimately contain no country label anchors.
  await readableLabels(page, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await readableLabels(page, 0);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.locator("#reset-map").click();
  await readableLabels(page, 3);
  await page.setViewportSize({ width: 320, height: 844 });
  await readableLabels(page, 3);
});
