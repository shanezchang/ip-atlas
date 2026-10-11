import type { Page, TestInfo } from "@playwright/test";
import { test, expect, observe, observation } from "./map-loading-harness.mjs";

// Synthetic corruptions exercise the real built loader and existing worker.
const polygon = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ],
  ],
};
const region = {
  type: "Feature",
  properties: {
    id: "synthetic-region",
    code: "US",
    name: "Synthetic region",
    zh: "合成地区",
    bounds: [0, 0, 1, 1],
  },
  geometry: polygon,
};
const collection = (feature: unknown) => ({
  type: "FeatureCollection",
  features: [region, feature],
});

async function lookupStillWorks(page: Page, origin: string) {
  await page.route(`${origin}/api/lookup`, (route) =>
    route.fulfill({
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
    }),
  );
  await page.locator("#ip-input").fill("192.0.2.1");
  await page.locator("#ip-input").press("Enter");
  await expect(page.locator(".result-ip")).toHaveText("192.0.2.1");
  await expect(page.locator("#submit")).toBeEnabled();
}

async function rejectsShape(
  page: Page,
  origin: string,
  info: TestInfo,
  source: "world" | "regions",
  value: unknown,
  lang = "en",
) {
  await observe(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript((language) => {
    localStorage.setItem("plotip-lang", language);
    const rejections: string[] = [];
    Object.assign(window, { shapeRejections: rejections });
    addEventListener("unhandledrejection", (e) =>
      rejections.push(String(e.reason)),
    );
  }, lang);
  let downloads = 0;
  await page.route(`${origin}/${source}.geojson`, (route) => {
    downloads++;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(value),
    });
  });
  await page.goto(origin);
  await expect
    .soft(page.locator("#map-loading"))
    .toHaveText(
      lang === "zh"
        ? "地图暂时无法显示，仍可查询 IP。"
        : "Map unavailable. IP lookup still works.",
    );
  await lookupStillWorks(page, origin);
  // Keep observing after the failure; a later load must not flip partial ready.
  await page.waitForTimeout(250);
  const seen = await observation(page);
  const rejected = await page.evaluate(
    () => (window as unknown as { shapeRejections: string[] }).shapeRejections,
  );
  await info.attach("shape-failure", {
    body: JSON.stringify({
      source,
      lang,
      downloads,
      pageErrors,
      rejected,
      seen,
    }),
    contentType: "application/json",
  });
  expect(downloads).toBe(1);
  expect(seen.ready).toBeNull();
  expect(pageErrors).toEqual([]);
  expect(rejected).toEqual([]);
  expect(seen.blobs.every((blob) => blob.revoked !== null)).toBe(true);
  expect(seen.workers.created).toBeLessThanOrEqual(1);
  expect(seen.jsonReads.some((url) => url.startsWith("blob:"))).toBe(false);
  await expect(page.locator("#map")).not.toHaveAttribute("data-ready", "true");
  await expect(page.locator("#map-loading")).toBeVisible();
  await expect(page.locator(".maplibregl-canvas")).toHaveCount(0);
}

const invalidRegions: [string, unknown][] = [
  ["object", {}],
  ["null", null],
  ["feature-not-collection", region],
  ["features-object", { type: "FeatureCollection", features: {} }],
  ["empty-collection", { type: "FeatureCollection", features: [] }],
  ["null-feature-after-valid", collection(null)],
  ["properties-null", collection({ ...region, properties: null })],
  [
    "missing-id",
    collection({
      ...region,
      properties: { ...region.properties, id: undefined },
    }),
  ],
  [
    "bounds-object",
    collection({ ...region, properties: { ...region.properties, bounds: {} } }),
  ],
  [
    "name-object",
    collection({ ...region, properties: { ...region.properties, name: {} } }),
  ],
  ["geometry-null", collection({ ...region, geometry: null })],
  [
    "polygon-container",
    collection({ ...region, geometry: { type: "Polygon", coordinates: {} } }),
  ],
  [
    "multipolygon-ring",
    collection({
      ...region,
      geometry: { type: "MultiPolygon", coordinates: [[[]]] },
    }),
  ],
  [
    "position-null",
    collection({
      ...region,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, null],
            [1, 1],
            [0, 0],
          ],
        ],
      },
    }),
  ],
];
for (const [name, value] of invalidRegions)
  test(`L1 regions rejects ${name}`, async ({ page, transport }, info) => {
    await rejectsShape(page, transport.origin, info, "regions", value);
  });

test("L1 regions malformed shape uses current Chinese language", async ({
  page,
  transport,
}, info) => {
  await rejectsShape(page, transport.origin, info, "regions", {}, "zh");
});

const country = {
  ...region,
  properties: { ...region.properties, rank: 1, lon: 0.5, lat: 0.5 },
};
const worldCollection = (feature: unknown) => ({
  type: "FeatureCollection",
  features: [country, feature],
});
const invalidWorld: [string, unknown][] = [
  ["object", {}],
  ["features-object", { type: "FeatureCollection", features: {} }],
  ["empty-collection", { type: "FeatureCollection", features: [] }],
  ["null-feature-after-valid", worldCollection(null)],
  ["properties-null", worldCollection({ ...country, properties: null })],
  [
    "missing-name",
    worldCollection({
      ...country,
      properties: { ...country.properties, name: undefined },
    }),
  ],
  [
    "name-null",
    worldCollection({
      ...country,
      properties: { ...country.properties, name: null },
    }),
  ],
  [
    "invalid-display-code",
    worldCollection({
      ...country,
      properties: { ...country.properties, code: "1!" },
    }),
  ],
  [
    "label-coordinate",
    worldCollection({
      ...country,
      properties: { ...country.properties, lat: "north" },
    }),
  ],
  [
    "rank-object",
    worldCollection({
      ...country,
      properties: { ...country.properties, rank: {} },
    }),
  ],
  [
    "missing-bounds",
    worldCollection({
      ...country,
      properties: { ...country.properties, bounds: undefined },
    }),
  ],
  ["geometry-null", worldCollection({ ...country, geometry: null })],
  [
    "polygon-container",
    worldCollection({
      ...country,
      geometry: { type: "Polygon", coordinates: {} },
    }),
  ],
  [
    "unclosed-ring",
    worldCollection({
      ...country,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        ],
      },
    }),
  ],
];
for (const [name, value] of invalidWorld)
  test(`L2 world rejects ${name}`, async ({ page, transport }, info) => {
    await rejectsShape(page, transport.origin, info, "world", value);
  });

test("L2 world malformed shape uses current Chinese language", async ({
  page,
  transport,
}, info) => {
  await rejectsShape(page, transport.origin, info, "world", {}, "zh");
});

test("L2 asynchronous label initialization errors fail closed", async ({
  page,
  transport,
}, info) => {
  await observe(page);
  await page.addInitScript(() => {
    const original = Intl.DisplayNames.prototype.of;
    let calls = 0;
    Intl.DisplayNames.prototype.of = function (code) {
      if (++calls === 3)
        throw new Error("synthetic label initialization failure");
      return original.call(this, code);
    };
  });
  await page.goto(transport.origin);
  await expect
    .soft(page.locator("#map-loading"))
    .toHaveText("Map unavailable. IP lookup still works.");
  await lookupStillWorks(page, transport.origin);
  const seen = await observation(page);
  await info.attach("label-initialization-failure", {
    body: JSON.stringify(seen),
    contentType: "application/json",
  });
  expect(seen.ready).toBeNull();
  expect(seen.blobs.every((blob) => blob.revoked !== null)).toBe(true);
  await expect(page.locator(".country-label")).toHaveCount(0);
  await expect(page.locator(".maplibregl-canvas")).toHaveCount(0);
});

test("unmodified real assets contain usable province/state worker data", async ({
  page,
  transport,
}, info) => {
  await observe(page);
  await page.goto(transport.origin);
  await expect(page.locator("#map")).toHaveAttribute("data-ready", "true");
  const tiles = await Promise.all(
    page.workers().map((worker) =>
      worker.evaluate(() => {
        // Diagnostic only: read the actual installed MapLibre worker index.
        const state = self as unknown as {
          worker: {
            workerSources: Record<
              string,
              {
                geojson: Record<
                  string,
                  {
                    _geoJSONIndex: {
                      getTile: (
                        z: number,
                        x: number,
                        y: number,
                      ) => {
                        features: {
                          tags: { id: string; code: string; name: string };
                        }[];
                      };
                    };
                  }
                >;
              }
            >;
          };
        };
        return Object.values(state.worker.workerSources).map((map) => ({
          world: map.geojson.world._geoJSONIndex.getTile(0, 0, 0).features
            .length,
          regions: map.geojson.regions._geoJSONIndex
            .getTile(0, 0, 0)
            .features.map((feature) => feature.tags),
        }));
      }),
    ),
  );
  const seen = await observation(page);
  await info.attach("real-asset-positive", {
    body: JSON.stringify({ tiles, seen, requests: transport.requests }),
    contentType: "application/json",
  });
  const regions = tiles.flatMap((maps) => maps.flatMap((map) => map.regions));
  expect(
    regions.some((p) => p.code === "US" && p.name === "California" && p.id),
  ).toBe(true);
  expect(
    regions.some((p) => p.code === "CN" && p.name === "Beijing" && p.id),
  ).toBe(true);
  expect(seen.workers.created).toBe(1);
  expect(seen.blobs.every((blob) => blob.revoked !== null)).toBe(true);
  expect(seen.jsonReads.some((url) => url.startsWith("blob:"))).toBe(false);
  for (const path of ["/world.geojson", "/regions.geojson"])
    expect(
      transport.requests.filter((request) => request.path === path),
    ).toHaveLength(1);
});
