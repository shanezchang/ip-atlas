import { test, expect } from "./fixtures";

// Exercise Chinese workflows explicitly; first-visit English is tested separately.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("plotip-lang"))
      localStorage.setItem("plotip-lang", "zh");
  });
});

test("IPv4 query updates real map, history, language and theme without shipping XDB", async ({
  page,
}) => {
  const errors: string[] = [];
  const urls: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => urls.push(r.url()));
  await page.goto("/");
  await expect(page.locator("#map")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "南京", exact: false }).click();
  await expect(page.locator(".place-title")).toHaveText("南京市");
  await expect(page.locator(".map-pin.selected")).toHaveAttribute(
    "aria-label",
    /114\.114/,
  );
  await expect(page.locator(".location-note")).toContainText("城市中心");
  await expect(page.locator(".history-item")).toHaveCount(1);
  await page.getByRole("button", { name: "Switch to English" }).click();
  await expect(page.locator(".place-title")).toHaveText("Nanjing");
  await page.getByRole("button", { name: "Toggle color theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(urls.some((u) => u.includes(".xdb"))).toBeFalsy();
  expect(errors).toEqual([]);
  await expect(page.locator(".place-title")).toHaveCSS(
    "color",
    "rgb(237, 240, 248)",
  );
});

test("IPv6 and region fallback do not claim device coordinates", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "深圳 · IPv6", exact: false }).click();
  await expect(page.locator(".place-title")).toHaveText("深圳市");
  await expect(page.locator(".version-badge")).toHaveText("IPv6");
  await page.getByRole("button", { name: "加利福尼亚", exact: false }).click();
  await expect(page.locator(".location-note")).toContainText("省 / 州参考位置");
  await expect(page.locator(".history-item")).toHaveCount(2);
  await page.locator(".history-item").nth(1).click();
  await expect(page.locator(".place-title")).toHaveText("深圳市");
  await page.getByRole("button", { name: "清空", exact: true }).click();
  await expect(page.locator(".history-item")).toHaveCount(0);
  await expect(page.locator(".map-pin")).toHaveCount(0);
});

test("invalid and non-public IPs remain understandable", async ({ page }) => {
  await page.goto("/");
  await page.locator("#ip-input").fill("not-an-ip");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("有效");
  await expect(page.locator("#ip-input")).toBeFocused();
  await page.locator("#ip-input").fill("2001:::1");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("有效");
  await expect(page.locator("#ip-input")).toBeFocused();
  await page.locator("#ip-input").fill("192.168.1.1");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect(page.locator(".place-title")).toHaveText("非公网地址");
  await expect(page.locator(".map-pin")).toHaveCount(0);
});

test("network errors recover and history survives reload only within session", async ({
  page,
}) => {
  await page.goto("/");
  await page.route("**/api/lookup", (route) => route.abort());
  await page.getByRole("button", { name: "南京", exact: false }).click();
  await expect(page.getByRole("alert")).toContainText("查询暂时失败");
  await expect(page.locator("#submit")).toBeEnabled();
  await page.unroute("**/api/lookup");
  await page.getByRole("button", { name: "南京", exact: false }).click();
  await expect(page.locator(".place-title")).toHaveText("南京市");
  await page.reload();
  await expect(page.locator(".history-item")).toHaveCount(1);
  await page.locator(".history-item").click();
  await expect(page.locator(".place-title")).toHaveText("南京市");
});

test("empty input is local and a server error can be retried", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/lookup")) requests.push(r.url());
  });
  await page.goto("/");
  await page.locator("#submit").click();
  await expect(page.getByRole("alert")).toContainText("有效");
  await expect(page.locator("#ip-input")).toBeFocused();
  expect(requests).toEqual([]);
  await page.route("**/api/lookup", (route) =>
    route.fulfill({ status: 503, json: { detail: "data_unavailable" } }),
  );
  await page.locator("#ip-input").fill("8.8.8.8");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("暂时失败");
  await expect(page.locator("#submit")).toBeEnabled();
  await page.unroute("**/api/lookup");
  await page.keyboard.press("Enter");
  await expect(page.locator(".result-ip")).toHaveText("8.8.8.8");
  await expect(page.getByRole("alert")).toBeHidden();
});

test("explicit no-record fixture never leaves a stale geographic pin", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "南京", exact: false }).click();
  await expect(page.locator(".map-pin.selected")).toBeVisible();
  // Isolate a missing database record; do not claim this is live attribution.
  await page.route("**/api/lookup", async (route) => {
    const response = await route.fetch();
    const actual = await response.json();
    await route.fulfill({
      json: {
        ...actual,
        scope: "unmapped",
        location: null,
        country: "",
        region: "",
        city: "",
        isp: "",
      },
    });
  });
  await page.locator("#submit").click();
  await expect(page.locator(".place-title")).toHaveText("暂无归属地");
  await expect(page.locator(".map-pin")).toHaveCount(0);
  await page.getByRole("button", { name: "Switch to English" }).click();
  await expect(page.locator(".place-title")).toHaveText("No location found");
});

test("map asset failure leaves real IP lookup available", async ({ page }) => {
  await page.route("**/world.geojson", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator("#map-loading")).toContainText("仍可查询 IP");
  await page.getByRole("button", { name: "南京", exact: false }).click();
  await expect(page.locator(".place-title")).toHaveText("南京市");
});

test("keyboard shortcut and accessible about dialog", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("/");
  await expect(page.locator("#ip-input")).toBeFocused();
  await page.getByRole("button", { name: "关于与数据来源" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "关于与数据来源" }),
  ).toBeFocused();
});

for (const width of [320, 390, 1440])
  test(`layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page
      .getByRole("button", { name: "深圳 · IPv6", exact: false })
      .click();
    await expect(page.locator(".place-title")).toHaveText("深圳市");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await expect(page.locator("#map")).toHaveAttribute("data-ready", "true");
    await page.screenshot({
      path: `.cache/screenshot-${width}.png`,
      fullPage: true,
    });
  });

test("markers stay anchored after repeated queries and selecting history", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await expect(page.locator("#map")).toHaveAttribute("data-ready", "true");
  await page.locator("#ip-input").fill("195.211.97.37");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect(page.locator(".coordinate-line")).toContainText("120.36° W");
  await page.getByRole("button", { name: "南京", exact: false }).click();
  await expect(page.locator(".place-title")).toHaveText("南京市");
  const pin = page.locator(".map-pin.selected");
  await expect(pin).toHaveCSS("position", "absolute");
  await expect
    .poll(async () => {
      const r = await pin.boundingBox();
      const m = await page.locator("#map").boundingBox();
      return Math.abs(r!.y + r!.height / 2 - (m!.y + m!.height / 2));
    })
    .toBeLessThan(3);
  await page.locator(".history-item").nth(1).click();
  await expect(page.locator(".place-title")).toHaveText("Washington");
  const box = await pin.boundingBox();
  const panel = await page.locator(".rail").boundingBox();
  expect(box!.x).toBeGreaterThan(panel!.x + panel!.width);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const r = await pin.boundingBox();
      return r!.x;
    })
    .toBeLessThan(300);
  const mobile = await pin.boundingBox();
  expect(mobile!.x).toBeGreaterThan(40);
});
