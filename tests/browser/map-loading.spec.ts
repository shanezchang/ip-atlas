import {
  test,
  expect,
  synthetic320,
  observe,
  observation,
  resourceKey,
} from "./map-loading-harness.mjs";

for (const width of [1440, 320])
  test(`cold resources overlap and complete the full map at ${width}px`, async ({
    page,
    context,
    transport,
  }, info) => {
    for (const [key, delay] of synthetic320) transport.delays.set(key, delay);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await observe(page);
    const finished: {
      path: string;
      timing: ReturnType<import("@playwright/test").Request["timing"]>;
    }[] = [];
    context.on("requestfinished", (r) =>
      finished.push({ path: resourceKey(r.url()), timing: r.timing() }),
    );
    await page.goto(transport.origin);
    const expectStart = await page.evaluate(() => performance.now());
    await expect
      .soft(page.locator("#map"))
      .toHaveAttribute("data-ready", "true", { timeout: 5000 });
    // Fixed observation tail never retries or replaces the failed 5s assertion.
    await page.waitForTimeout(2500);
    const seen = await observation(page);
    await info.attach("cold-timing", {
      body: JSON.stringify({
        expectStart,
        ...seen,
        finished,
        requests: transport.requests,
      }),
      contentType: "application/json",
    });
    const map = transport.requests.find((r) => r.path === "/assets/map.js")!;
    for (const key of ["/world.geojson", "/regions.geojson"]) {
      const requests = transport.requests.filter((r) => r.path === key);
      expect.soft(requests, `${key} real download once`).toHaveLength(1);
      expect
        .soft(requests[0]?.start, `${key} starts before map JS arrives`)
        .toBeLessThan(map.sent!);
    }
    expect
      .soft(
        transport.requests.filter((r) => r.path === "/assets/worker.js"),
        "one existing worker script",
      )
      .toHaveLength(1);
    expect.soft(seen.labels).toBeGreaterThan(150);
    expect
      .soft(
        seen.jsonReads.filter((url) => url.startsWith("blob:")),
        "regions JSON must not parse on main thread",
      )
      .toEqual([]);
    expect.soft(seen.largeJSON).toEqual([]);
    expect
      .soft(seen.ready, "absolute navigationStart to full ready")
      .toBeLessThan(6000);
  });

test("native cold and warm navigation use the same complete map without duplicate downloads", async ({
  browser,
  transport,
}, info) => {
  // This context deliberately has no routing, so native HTTP caching is real.
  // The local static server supplies restrictive CSP and the offline runner
  // disables proxy/DNS; the server never serves APIs or non-static requests.
  transport.cache.enabled = true;
  const context = await browser.newContext({
    viewport: { width: 320, height: 900 },
    colorScheme: "dark",
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const errors: string[] = [],
    unexpected: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  context.on("request", (r) => {
    if (
      r.method() !== "GET" ||
      (!r.url().startsWith("blob:") &&
        (new URL(r.url()).origin !== transport.origin ||
          !/^\/(?:$|assets\/[^/]+\.(?:js|css|woff2?|svg)$|(?:world|regions)\.geojson$|(?:favicon|plotip-mark)\.svg$)/.test(
            new URL(r.url()).pathname,
          )))
    )
      unexpected.push(r.url());
  });
  await observe(page);
  const observations = [];
  try {
    for (const mode of ["cold", "warm"]) {
      await page.goto(transport.origin);
      const expectStart = await page.evaluate(() => performance.now());
      await expect(page.locator("#map")).toHaveAttribute("data-ready", "true", {
        timeout: 5000,
      });
      const seen = await observation(page);
      expect(seen.labels).toBeGreaterThan(150);
      expect(seen.workers.created).toBe(1);
      expect(seen.blobs.every((blob) => blob.revoked !== null)).toBe(true);
      expect(seen.jsonReads.some((url) => url.startsWith("blob:"))).toBe(false);
      observations.push({ mode, expectStart, ...seen });
    }
    for (const key of ["/world.geojson", "/regions.geojson"])
      expect(
        transport.requests.filter((r) => r.path === key),
        `${key} only one download across native cached revisit`,
      ).toHaveLength(1);
    const warm = observations[1];
    for (const name of ["world.geojson", "regions.geojson"]) {
      const resource = warm.resources.find((r) =>
        String(r.name).endsWith(name),
      );
      expect(
        resource?.transferSize,
        `${name} actually served from HTTP cache`,
      ).toBe(0);
    }
    await page.getByRole("button", { name: "切换到中文" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
  } finally {
    await info.attach("native-cache", {
      body: JSON.stringify({
        observations,
        requests: transport.requests,
        errors,
        unexpected,
      }),
      contentType: "application/json",
    });
    await context.close();
    expect(page.isClosed()).toBe(true);
    expect(page.workers()).toHaveLength(0);
  }
});
