import { test, expect, type Page } from "./fixtures";

async function openRanges(page: Page, country = "US") {
  await page.goto("/");
  await page.getByRole("button", { name: "IP ranges", exact: true }).click();
  await expect(
    page.locator('#range-country option[value="country:US"]'),
  ).toBeAttached();
  await page.locator("#range-country").selectOption(`country:${country}`);
  await expect(page.locator(".range-row")).toHaveCount(20);
}
async function mapCenter(page: Page) {
  await page.locator("#map").scrollIntoViewIfNeeded();
  const map = (await page.locator("#map").boundingBox())!;
  const rail = (await page.locator(".rail").boundingBox())!;
  return {
    x: map.x + (rail.x + rail.width + 32 + map.width - 64) / 2,
    y: map.y + map.height / 2,
  };
}

test("map clicks select a country then a real state polygon", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await expect(page.locator("#map")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "California", exact: false }).click();
  await expect(page.locator(".place-title")).toHaveText("California");
  const pin = (await page.locator(".map-pin.selected").boundingBox())!;
  await page.mouse.click(pin.x + pin.width / 2, pin.y + pin.height / 2 + 40);
  await expect(page.locator("#range-title")).toHaveText("United States");
  await expect(page.locator(".range-row")).toHaveCount(20);
  await page.locator("#map-level").selectOption("region");
  const center = await mapCenter(page);
  const response = page.waitForResponse(
    (r) => r.url().includes("/api/ranges?area=region") && r.status() === 200,
  );
  await page.mouse.click(center.x, center.y);
  const data = await (await response).json();
  expect(data.area.level).toBe("region");
  expect(data.area.country_code).toBe("US");
  await expect(page.locator("#range-title")).toHaveText(data.area.name);
  await page.screenshot({ path: ".cache/ranges-desktop.png" });
});

test("pagination, IPv6, exact CIDR copy and forward lookup form a loop", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await openRanges(page);
  await expect(page.locator("#range-region")).toBeEnabled();
  await page.locator("#range-region").selectOption({ label: "California" });
  await expect(page.locator("#range-title")).toHaveText("California");
  await expect(page.locator(".range-row")).toHaveCount(20);
  const first = await page.locator(".range-address").first().innerText();
  await page.getByRole("button", { name: "Next", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".range-pagination span")).toHaveText("21–40");
  await expect(page.locator("#range-next")).toBeFocused();
  expect(await page.locator(".range-address").first().innerText()).not.toBe(
    first,
  );
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.locator(".range-address").first()).toHaveText(first, {
    useInnerText: true,
  });
  await page.getByRole("button", { name: "IPv6", exact: true }).click();
  await expect(page.locator(".range-pagination span")).toHaveText("1–20");
  await expect(page.locator(".range-address").first()).toContainText(":");
  const row = page.locator(".range-row").first();
  await row.locator("summary").focus();
  await page.keyboard.press("Enter");
  const cidrs = await row.locator("pre").innerText();
  const address = await row.locator("code").first().innerText();
  await page.keyboard.press("Tab");
  const copy = row.getByRole("button", { name: "Copy CIDRs", exact: true });
  await expect(copy).toBeFocused();
  // Also prove a pointer can reach the scrolled action above the sticky pager.
  await copy.click({ trial: true });
  await expect(copy).toBeInViewport();
  await page.screenshot({
    path: ".cache/journey-region-cidrs.png",
    fullPage: true,
  });
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(cidrs);
  await page.keyboard.press("Tab");
  await expect(
    row.getByRole("button", { name: "Look up first IP", exact: false }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#workspace")).toHaveAttribute(
    "data-mode",
    "lookup",
  );
  await expect(page.locator(".result-ip")).toHaveText(address);
  await expect(page.locator("#ip-input")).toBeFocused();
  expect(requests.some((url) => /\.(sqlite|xdb)/.test(url))).toBe(false);
  await page.screenshot({
    path: ".cache/journey-first-ip.png",
    fullPage: true,
  });
  await test.info().attach("real-range-journey", {
    body: JSON.stringify({
      region: "California",
      firstIPv4Row: first,
      copiedCIDRs: await page.evaluate(() => navigator.clipboard.readText()),
      displayedCIDRs: cidrs,
      firstIPv6Address: address,
      result: await page.locator(".result-ip").innerText(),
      focus: await page.evaluate(() => document.activeElement?.id),
      requests: requests.filter((url) =>
        new URL(url).pathname.startsWith("/api/"),
      ),
    }),
    contentType: "application/json",
  });
});

async function firstRange(page: Page, version: 4 | 6) {
  await page.locator("#mode-ranges").click();
  await expect(
    page.locator('#range-country option[value="country:US"]'),
  ).toBeAttached();
  await page.locator("#range-country").selectOption("country:US");
  await expect(page.locator("#range-region")).toBeEnabled();
  await page
    .getByRole("button", { name: `IPv${version}`, exact: true })
    .click();
  await expect(page.locator(".range-row")).toHaveCount(20);
  const row = page.locator(".range-row").first();
  await row.locator("summary").click();
  const ip = await row.locator("code").first().innerText();
  expect(ip.includes(":")).toBe(version === 6);
  return { row, ip };
}

for (const version of [4, 6] as const)
  for (const previous of ["114.114.114.114", ""])
    for (const failure of ["503", "disconnect"] as const)
      test(`first-IP Enter retry preserves IPv${version} target after ${failure} with ${previous ? "previous input" : "empty input"}`, async ({
        page,
        baseURL,
      }) => {
        const lookupURL = new URL("/api/lookup", baseURL).href;
        const requests: { method: string; body: unknown }[] = [];
        page.on("request", (request) => {
          if (request.url() === lookupURL)
            requests.push({
              method: request.method(),
              body: request.postDataJSON(),
            });
        });
        await page.goto("/");
        const input = page.locator("#ip-input");
        if (previous) {
          await input.fill(previous);
          await page.keyboard.press("Enter");
          await expect(page.locator(".result-ip")).toHaveText(previous);
        } else await expect(input).toHaveValue("");
        const { row, ip } = await firstRange(page, version);
        await page.route(lookupURL, (route) =>
          failure === "503"
            ? route.fulfill({
                status: 503,
                json: { detail: "data_unavailable" },
              })
            : route.abort("connectionreset"),
        );
        await row.getByRole("button", { name: "Look up first IP" }).click();
        await expect(page.locator("#workspace")).toHaveAttribute(
          "data-mode",
          "lookup",
        );
        await expect(page.locator("#error")).toHaveText(
          "Lookup unavailable. Please try again.",
        );
        await expect(page.locator("#submit")).toBeEnabled();
        await expect(input).toBeFocused();
        const failedInput = await input.inputValue();
        expect(requests.at(-1)).toEqual({ method: "POST", body: { ip } });
        // Soft assertions let RED also observe the actual Enter request, not just the input.
        await expect.soft(input).toHaveValue(ip, { timeout: 1000 });
        await page.unroute(lookupURL);
        const retried = page
          .waitForResponse((response) => response.url() === lookupURL, {
            timeout: 2000,
          })
          .catch(() => null);
        // Do not refill or refocus: retry must use the target preserved by the UI.
        await page.keyboard.press("Enter");
        const response = await retried;
        expect.soft(response, "Enter must send a retry request").not.toBeNull();
        if (response) {
          expect.soft(response.status()).toBe(200);
          expect.soft(response.request().postDataJSON()).toEqual({ ip });
          expect.soft((await response.json()).ip).toBe(ip);
        }
        expect
          .soft(requests)
          .toEqual([
            ...(previous ? [{ method: "POST", body: { ip: previous } }] : []),
            { method: "POST", body: { ip } },
            { method: "POST", body: { ip } },
          ]);
        await expect.soft(page.locator(".result-ip")).toHaveText(ip, {
          timeout: 1000,
        });
        await expect.soft(input).toHaveValue(ip, { timeout: 1000 });
        await expect.soft(page.locator("#error")).toBeHidden({ timeout: 1000 });
        await expect(input).toBeFocused();
        await test.info().attach("first-ip-retry", {
          body: JSON.stringify({
            version,
            previous,
            failure,
            intended: ip,
            failedInput,
            requests,
            retryStatus: response?.status() ?? null,
            finalInput: await input.inputValue(),
            finalResult: await page.locator(".result-ip").allTextContents(),
          }),
          contentType: "application/json",
        });
      });

async function holdFirstLookup(page: Page, url: string, invalid = false) {
  let release!: () => void;
  let ready!: () => void;
  let done!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const delivered = new Promise<void>((resolve) => {
    done = resolve;
  });
  await page.route(url, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    ready();
    await gate;
    try {
      if (invalid)
        await route.fulfill({ status: 400, json: { detail: "invalid_ip" } });
      else await route.fulfill({ response });
    } finally {
      done();
    }
  });
  return { held, release, delivered };
}

for (const version of [4, 6] as const)
  for (const draft of ["9.9.9.9", "2001:4860:4860::8888"])
    for (const outcome of ["success", "invalid"] as const)
      test(`pending IPv${version} first-IP ${outcome} preserves edited draft ${draft}`, async ({
        page,
        baseURL,
      }) => {
        const url = new URL("/api/lookup", baseURL).href;
        const requests: { method: string; body: unknown }[] = [];
        page.on("request", (request) => {
          if (request.url() === url)
            requests.push({
              method: request.method(),
              body: request.postDataJSON(),
            });
        });
        await page.goto("/");
        expect(await page.evaluate(() => navigator.webdriver)).toBe(true);
        const { row, ip } = await firstRange(page, version);
        const pending = await holdFirstLookup(page, url, outcome === "invalid");
        try {
          await row.getByRole("button", { name: "Look up first IP" }).click();
          await pending.held;
          await expect(page.locator("#submit")).toBeDisabled();
          const input = page.locator("#ip-input");
          await expect(input).toBeEditable();
          await input.fill(draft);
          await page.locator("#theme").focus();
          pending.release();
          await pending.delivered;
          await expect(page.locator("#submit")).toBeEnabled();
          const after = {
            input: await input.inputValue(),
            focus: await page.evaluate(() => document.activeElement?.id),
            invalid: await input.getAttribute("aria-invalid"),
          };
          expect.soft(after.input).toBe(draft);
          expect.soft(after.focus).toBe("theme");
          expect.soft(after.invalid).toBeNull();
          await expect
            .soft(page.locator("#error"))
            .toBeHidden({ timeout: 1000 });
          if (outcome === "success")
            await expect(page.locator(".result-ip")).toHaveText(ip);
          else await expect(page.locator(".result-ip")).toHaveCount(0);
          await page.screenshot({
            path: test.info().outputPath(`pending-${outcome}.png`),
          });
          await page.unroute(url);
          await input.focus();
          const next = page.waitForResponse(
            (response) => response.url() === url,
          );
          // Focus only: refilling here would conceal a late response overwriting the draft.
          await page.keyboard.press("Enter");
          const response = await next;
          const result = await response.json();
          expect.soft(response.status()).toBe(200);
          expect.soft(response.request().postDataJSON()).toEqual({ ip: draft });
          expect.soft(result.ip).toBe(draft);
          await expect
            .soft(page.locator(".result-ip"))
            .toHaveText(draft, { timeout: 1000 });
          await expect.soft(input).toHaveValue(draft, { timeout: 1000 });
          expect.soft(requests).toEqual([
            { method: "POST", body: { ip } },
            { method: "POST", body: { ip: draft } },
          ]);
          await test.info().attach(`pending-${outcome}-draft`, {
            body: JSON.stringify({
              version,
              outcome,
              ip,
              draft,
              after,
              requests,
              result,
            }),
            contentType: "application/json",
          });
        } finally {
          pending.release();
        }
      });

for (const version of [4, 6] as const)
  test(`pending IPv${version} first-IP invalid restores focus for an unedited draft`, async ({
    page,
    baseURL,
  }) => {
    await page.goto("/");
    const { row, ip } = await firstRange(page, version);
    const url = new URL("/api/lookup", baseURL).href;
    const pending = await holdFirstLookup(page, url, true);
    try {
      await row.getByRole("button", { name: "Look up first IP" }).click();
      await pending.held;
      await page.locator("#theme").focus();
      pending.release();
      await pending.delivered;
      await expect(page.locator("#submit")).toBeEnabled();
      const input = page.locator("#ip-input");
      await expect(input).toHaveValue(ip);
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(input).toBeFocused();
      await expect(page.locator("#error")).toHaveText(
        "Enter a valid IPv4 or IPv6 address.",
      );
      await page.unroute(url);
      const next = page.waitForResponse((response) => response.url() === url);
      await page.keyboard.press("Enter");
      const response = await next;
      expect(response.request().postDataJSON()).toEqual({ ip });
      expect(response.status()).toBe(200);
      expect((await response.json()).ip).toBe(ip);
      await expect(page.locator(".result-ip")).toHaveText(ip);
      await expect(input).not.toHaveAttribute("aria-invalid");
      await expect(page.locator("#error")).toBeHidden();
    } finally {
      pending.release();
    }
  });

for (const version of [4, 6] as const)
  for (const outcome of ["invalid", "success"] as const)
    test(`canceled IPv${version} first-IP ${outcome} response cannot steal ranges focus`, async ({
      page,
      baseURL,
    }) => {
      await page.goto("/");
      const { row, ip } = await firstRange(page, version);
      const lookupURL = new URL("/api/lookup", baseURL).href;
      let release!: () => void;
      let ready!: () => void;
      let done!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const held = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const delivered = new Promise<void>((resolve) => {
        done = resolve;
      });
      await page.route(lookupURL, async (route) => {
        expect(route.request().postDataJSON()).toEqual({ ip });
        const response = await route.fetch();
        ready();
        await gate;
        try {
          if (outcome === "invalid")
            await route.fulfill({
              status: 400,
              json: { detail: "invalid_ip" },
            });
          else await route.fulfill({ response });
        } finally {
          done();
        }
      });
      await row.getByRole("button", { name: "Look up first IP" }).click();
      await held;
      await expect(page.locator("#submit")).toBeDisabled();
      const canceled = page.waitForEvent("requestfailed", {
        predicate: (request) => request.url() === lookupURL,
      });
      await page.locator("#mode-ranges").click();
      await canceled;
      const country = page.locator("#range-country");
      await country.focus();
      release();
      await delivered;
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );
      await expect(page.locator("#workspace")).toHaveAttribute(
        "data-mode",
        "ranges",
      );
      await expect(country).toBeFocused();
      await expect(page.locator("#error")).toBeHidden();
      await expect(page.locator(".result-ip")).toHaveCount(0);
      await expect(page.locator(".history-item")).toHaveCount(0);
      await page.unroute(lookupURL);
      await page.locator("#mode-lookup").click();
      await expect(page.locator("#submit")).toBeEnabled();
      await page.locator("#ip-input").fill("8.8.8.8");
      const next = page.waitForResponse(
        (response) => response.url() === lookupURL,
      );
      await page.keyboard.press("Enter");
      const response = await next;
      expect(response.request().postDataJSON()).toEqual({ ip: "8.8.8.8" });
      expect(response.status()).toBe(200);
      await expect(page.locator(".result-ip")).toHaveText("8.8.8.8");
      await expect(page.locator("#ip-input")).toHaveValue("8.8.8.8");
    });

test("empty states, Chinese language and request failure recovery", async ({
  page,
}) => {
  await openRanges(page, "UY");
  await page.locator("#range-region").selectOption("region:URY-8");
  await page.getByRole("button", { name: "IPv6", exact: true }).click();
  await expect(page.locator(".range-empty")).toContainText("No IPv6 ranges");
  await page.getByRole("button", { name: "切换到中文" }).click();
  await expect(page.locator(".range-empty")).toContainText("未记录");
  await page.route("**/api/ranges?**", (route) => route.abort());
  await page.getByRole("button", { name: "IPv4", exact: true }).click();
  await expect(page.locator(".range-status")).toContainText("暂时无法");
  await page.unroute("**/api/ranges?**");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator(".range-status")).not.toContainText("暂时无法");
});

test("a slow previous area never replaces a newer selection", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "IP ranges", exact: true }).click();
  await expect(
    page.locator('#range-country option[value="country:US"]'),
  ).toBeAttached();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/ranges?**", async (route) => {
    if (
      new URL(route.request().url()).searchParams.get("area") === "country:US"
    ) {
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response }).catch(() => {});
    } else await route.continue();
  });
  const pending = page.waitForRequest((r) =>
    r.url().includes("/api/ranges?area=country%3AUS"),
  );
  await page.locator("#range-country").selectOption("country:US");
  await pending;
  await page.locator("#range-country").selectOption("country:CN");
  await expect(page.locator("#range-title")).toHaveText("China");
  await expect(page.locator(".range-row")).toHaveCount(20);
  release();
  await page.getByRole("button", { name: "IPv6", exact: true }).click();
  await expect(page.locator(".range-address").first()).toContainText(":");
  await expect(page.locator("#range-title")).toHaveText("China");
});

test("catalog retry and state selection preserve keyboard focus", async ({
  page,
}) => {
  await page.route("**/api/areas", (route) =>
    route.fulfill({ status: 503, json: { detail: "data_unavailable" } }),
  );
  await page.goto("/");
  await page.locator("#mode-ranges").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".range-error")).toContainText(
    "Place list unavailable",
  );
  await page.unroute("**/api/areas");
  await page.locator("#catalog-retry").focus();
  await page.keyboard.press("Enter");
  await expect(
    page.locator('#range-country option[value="country:US"]'),
  ).toBeAttached();
  const country = page.locator("#range-country");
  await country.focus();
  await country.selectOption("country:US");
  await expect(page.locator(".range-row")).toHaveCount(20);
  await expect(country).toBeFocused();
  await expect(page.locator("#range-region")).toBeEnabled();
  await page.keyboard.press("Tab");
  await expect(page.locator("#range-region")).toBeFocused();
  await page.locator("#range-region").selectOption({ label: "California" });
  await expect(page.locator("#range-title")).toHaveText("California");
  await expect(page.locator(".range-row")).toHaveCount(20);
  await expect(page.locator("#range-region")).toBeFocused();
  await expect(page.locator("#range-region")).toHaveCSS(
    "outline-style",
    "solid",
  );
});

test("clipboard denial keeps exact CIDRs available for manual copying", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: () =>
          Promise.reject(new DOMException("Denied", "NotAllowedError")),
      },
    });
  });
  await openRanges(page);
  const row = page.locator(".range-row").first();
  await row.locator("summary").click();
  const cidrs = await row.locator("pre").innerText();
  await row.getByRole("button", { name: "Copy CIDRs", exact: true }).click();
  await expect(page.locator("#toast")).toContainText(
    "Select the CIDRs manually",
  );
  await expect(row.locator("pre")).toHaveText(cidrs);
});

for (const width of [320, 390])
  test(`reverse ranges at ${width}px in dark mode`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openRanges(page);
    await page.getByRole("button", { name: "Toggle color theme" }).click();
    await page.getByRole("button", { name: "IPv6", exact: true }).click();
    await expect(page.locator(".range-address").first()).toContainText(":");
    await page.locator(".range-row summary").first().click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.locator("#map")).toHaveAttribute("data-ready", "true");
    await page.screenshot({
      path: `.cache/ranges-mobile-${width}.png`,
      fullPage: true,
    });
    const copy = page
      .locator(".range-row")
      .first()
      .getByRole("button", { name: "Copy CIDRs", exact: true });
    await copy.click({ trial: true });
    await expect(copy).toBeInViewport();
    await page.screenshot({
      path: `.cache/ranges-mobile-actions-${width}.png`,
      fullPage: true,
    });
  });
