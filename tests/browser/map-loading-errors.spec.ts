import type { Page } from "@playwright/test";
import { test, expect, observe, observation } from "./map-loading-harness.mjs";

async function lookupStillWorks(page: Page, origin: string) {
  await page.route(`${origin}/api/lookup`, async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ ip: "192.0.2.1" });
    await route.fulfill({
      json: {
        ip: "192.0.2.1",
        version: 4,
        scope: "reserved",
        country: null,
        region: null,
        city: null,
        isp: null,
        country_code: null,
        location: null,
        data_version: "synthetic-only",
      },
    });
  });
  await page.locator("#ip-input").fill("192.0.2.1");
  await page.locator("#ip-input").press("Enter");
  await expect(page.locator(".result-ip")).toHaveText("192.0.2.1");
  await expect(page.locator("#submit")).toBeEnabled();
}

test("malformed regions never announces a partial map as ready", async ({
  page,
  transport,
}, info) => {
  await observe(page);
  await page.route(`${transport.origin}/regions.geojson`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{invalid",
    }),
  );
  await page.goto(transport.origin);
  await expect
    .soft(page.locator("#map-loading"))
    .toHaveText("Map unavailable. IP lookup still works.");
  await lookupStillWorks(page, transport.origin);
  await page.waitForTimeout(500);
  const seen = await observation(page);
  await info.attach("fault-observation", {
    body: JSON.stringify(seen),
    contentType: "application/json",
  });
  expect
    .soft(seen.ready, "no ready mutation after a failed critical source")
    .toBeNull();
  await expect(page.locator("#map")).not.toHaveAttribute("data-ready", "true");
  await expect(page.locator("#map-loading")).toBeVisible();
  expect(seen.blobs.every((blob) => blob.revoked !== null)).toBe(true);
  // MapLibre's RTL global dispatcher retains one worker even in the baseline.
  // The failed map must be removed, without creating any additional worker.
  expect(seen.workers.created).toBe(1);
  await expect(page.locator(".maplibregl-canvas")).toHaveCount(0);
});

for (const fault of [
  "world-http",
  "regions-http",
  "world-json",
  "import-early",
  "import-late",
  "worker-http",
  "multiple",
] as const)
  test(`${fault} fails closed with lookup available and no dangling resources`, async ({
    page,
    context,
    transport,
  }, info) => {
    await observe(page);
    if (fault === "worker-http")
      await context.route("**/assets/maplibre-gl-worker-*.js", (route) =>
        route.abort("connectionreset"),
      );
    if (fault === "import-early") {
      transport.delays.set("/world.geojson", 1000);
      transport.delays.set("/regions.geojson", 1000);
    }
    await page.route("**/*", async (route) => {
      const p = new URL(route.request().url()).pathname;
      const isImport = /\/assets\/map-[^/]+\.js$/.test(p);

      if ((fault.startsWith("import") || fault === "multiple") && isImport) {
        if (fault === "import-late")
          await new Promise((resolve) => setTimeout(resolve, 1000));
        return route.abort("connectionreset");
      }
      if (
        (fault.startsWith("world") || fault === "multiple") &&
        p === "/world.geojson"
      )
        return route.fulfill({
          status: fault === "world-json" ? 200 : 503,
          contentType: "application/json",
          body: "{invalid",
        });
      if (
        (fault === "regions-http" || fault === "multiple") &&
        p === "/regions.geojson"
      )
        return route.fulfill({ status: 503, body: "unavailable" });
      return route.fallback();
    });
    await page.goto(transport.origin);
    await expect(page.locator("#map-loading")).toHaveText(
      "Map unavailable. IP lookup still works.",
    );
    await lookupStillWorks(page, transport.origin);
    await page.waitForTimeout(1200);
    const seen = await observation(page);
    await info.attach("fault-observation", {
      body: JSON.stringify(seen),
      contentType: "application/json",
    });
    expect(seen.ready).toBeNull();
    await expect(page.locator("#map")).not.toHaveAttribute(
      "data-ready",
      "true",
    );
    await expect(page.locator("#map-loading")).toBeVisible();
    expect(seen.blobs.every((blob) => blob.revoked !== null)).toBe(true);
    expect(seen.workers.created).toBe(fault === "worker-http" ? 1 : 0);
    await expect(page.locator(".maplibregl-canvas")).toHaveCount(0);
  });

for (const held of ["world", "regions", "import"] as const)
  test(`holding ${held} keeps full ready false while lookup is usable`, async ({
    page,
    transport,
  }, info) => {
    await observe(page);
    let release!: () => void;
    let arrived!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requested = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const pattern =
      held === "import"
        ? "**/assets/map-*.js"
        : `${transport.origin}/${held}.geojson`;
    await page.route(pattern, async (route) => {
      arrived();
      await gate;
      await route.continue();
    });
    try {
      await page.goto(transport.origin);
      await requested;
      await lookupStillWorks(page, transport.origin);
      const pending = await observation(page);
      expect(pending.ready).toBeNull();
      expect(await page.locator("#map").getAttribute("data-ready")).not.toBe(
        "true",
      );
      release();
      await expect(page.locator("#map")).toHaveAttribute("data-ready", "true", {
        timeout: 5000,
      });
      const complete = await observation(page);
      expect(complete.labels).toBeGreaterThan(150);
      expect(
        complete.blobs.filter((blob) => blob.bytes === 6379619),
      ).toHaveLength(1);
      expect(complete.blobs).toHaveLength(2);
      expect(complete.blobs.every((blob) => blob.revoked !== null)).toBe(true);
      expect(complete.workers.created).toBe(1);
      expect(complete.largeJSON).toEqual([]);
      expect(
        complete.jsonReads.some(
          (url) => url.startsWith("blob:") || url.endsWith("/regions.geojson"),
        ),
      ).toBe(false);
      await info.attach("gated-readiness", {
        body: JSON.stringify({ held, pending, complete }),
        contentType: "application/json",
      });
    } finally {
      release();
    }
  });
