import { test as base, expect } from "@playwright/test";

// No telemetry, external services, or non-lookup writes during browser QA.
// Later test routes may inject explicit local error/empty fixtures.
export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const origin = new URL(baseURL!).origin;
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.route("**/*", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const read =
        request.method() === "GET" &&
        (url.pathname === "/" ||
          /^\/api\/(health|areas|ranges|me)$/.test(url.pathname) ||
          /^\/(assets\/[^?]+\.(js|css|woff2?|svg)|world\.geojson|regions\.geojson|favicon\.svg|plotip-mark\.svg)$/.test(
            url.pathname,
          ));
      const lookup =
        request.method() === "POST" && url.pathname === "/api/lookup";
      return url.origin === origin && (read || lookup)
        ? route.continue()
        : route.abort("blockedbyclient");
    });
    await use(page);
    expect(pageErrors, "unhandled browser exceptions").toEqual([]);
  },
});
export { expect };
export type { Page } from "@playwright/test";
