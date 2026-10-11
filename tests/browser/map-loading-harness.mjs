import { test as base, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import path from "node:path";

export function resourceKey(url) {
  return new URL(url, "http://127.0.0.1").pathname
    .replace(/\/assets\/index-[^/]+\.js$/, "/assets/index.js")
    .replace(/\/assets\/index-[^/]+\.css$/, "/assets/index.css")
    .replace(/\/assets\/map-[^/]+\.js$/, "/assets/map.js")
    .replace(/\/assets\/maplibre-gl-worker-[^/]+\.js$/, "/assets/worker.js");
}
// Fixed first-byte holds, not bandwidth throttling or a production replay.
export const synthetic320 = new Map([
  ["/", 900.958],
  ["/assets/index.js", 498.924],
  ["/assets/index.css", 649.882],
  ["/assets/dist-BmAaLLsf.js", 205.705],
  ["/assets/map.js", 1041.856],
  ["/world.geojson", 2260.889],
  ["/assets/worker.js", 332.569],
  ["/regions.geojson", 1671.927],
  ["/assets/ibm-plex-mono-latin-400-normal-DMJ8VG8y.woff2", 431.123],
  ["/assets/manrope-latin-wght-normal-DHIcAJRg.woff2", 820.342],
  ["/favicon.svg", 672.302],
]);
const staticPath = (p) =>
  p === "/" ||
  /^\/(assets\/[^/?]+\.(js|css|woff2?|svg)|world\.geojson|regions\.geojson|favicon\.svg|plotip-mark\.svg)$/.test(
    p,
  );
export const test = base.extend({
  transport: async ({}, use, info) => {
    const requests = [];
    const delays = new Map();
    const cache = { enabled: false };
    const timers = new Set();
    const root = process.env.MAP_STATIC_ROOT || path.resolve("public");
    const server = createServer(async (req, res) => {
      const p = new URL(req.url, "http://127.0.0.1").pathname;
      if (req.method !== "GET" || !staticPath(p) || p.includes("..")) {
        res.writeHead(403).end();
        return;
      }
      const entry = { path: resourceKey(p), start: Date.now() };
      requests.push(entry);
      try {
        const body = await readFile(
          path.join(root, p === "/" ? "index.html" : p),
        );
        const timer = setTimeout(
          () => {
            timers.delete(timer);
            if (res.destroyed) return;
            const type =
              p === "/"
                ? "text/html"
                : p.endsWith(".js")
                  ? "text/javascript"
                  : p.endsWith(".css")
                    ? "text/css"
                    : p.endsWith(".geojson")
                      ? "application/json"
                      : p.endsWith(".woff2")
                        ? "font/woff2"
                        : "image/svg+xml";
            res.writeHead(200, {
              "Content-Type": type,
              "Content-Length": body.length,
              "Cache-Control": cache.enabled
                ? "public, max-age=3600"
                : "no-store",
              "Content-Security-Policy":
                "default-src 'self'; connect-src 'self' blob:; script-src 'self' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; object-src 'none'",
            });
            res.end(body);
            entry.sent = Date.now();
            entry.bytes = body.length;
          },
          delays.get(entry.path) || 0,
        );
        timers.add(timer);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    try {
      await use({
        origin: `http://127.0.0.1:${port}`,
        requests,
        delays,
        cache,
      });
    } finally {
      for (const timer of timers) clearTimeout(timer);
      server.closeAllConnections();
      await new Promise((resolve) => server.close(() => resolve()));
      const closed = await new Promise((resolve) => {
        const socket = createConnection({ host: "127.0.0.1", port });
        socket.once("connect", () => {
          socket.destroy();
          resolve(false);
        });
        socket.once("error", () => resolve(true));
      });
      await info.attach("transport", {
        body: JSON.stringify({ requests, port, closed }),
        contentType: "application/json",
      });
      expect(closed, "owned loopback listener closed").toBe(true);
    }
  },
  page: async ({ page, context, transport }, use, info) => {
    const errors = [];
    const blocked = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await context.route("**/*", (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (
        url.origin === transport.origin &&
        req.method() === "GET" &&
        staticPath(url.pathname)
      )
        return route.continue();
      blocked.push(req.url());
      return route.abort("blockedbyclient");
    });
    await use(page);
    const workerCount = page.workers().length;
    await page.close();
    expect(page.workers(), "owned page workers closed").toHaveLength(0);
    await info.attach("page-cleanup", {
      body: JSON.stringify({
        workerCount,
        pageClosed: page.isClosed(),
        remainingWorkers: page.workers().length,
        browser: context.browser().version(),
      }),
      contentType: "application/json",
    });
    expect(errors, "unhandled browser exceptions").toEqual([]);
    expect(blocked, "unexpected network/telemetry").toEqual([]);
  },
});
export { expect };
export async function observe(page) {
  await page.addInitScript(() => {
    const probe = {
      ready: null,
      longtasks: [],
      blobs: [],
      jsonReads: [],
      largeJSON: [],
      workers: { created: 0, terminated: 0 },
    };
    Object.assign(window, { __loadingProbe: probe });
    const create = URL.createObjectURL,
      revoke = URL.revokeObjectURL;
    URL.createObjectURL = function (blob) {
      const url = create.call(this, blob);
      probe.blobs.push({
        url,
        bytes: blob.size,
        created: performance.now(),
        revoked: null,
      });
      return url;
    };
    URL.revokeObjectURL = function (url) {
      const entry = probe.blobs.find((item) => item.url === url);
      if (entry) entry.revoked = performance.now();
      return revoke.call(this, url);
    };
    const json = Response.prototype.json,
      parse = JSON.parse;
    Response.prototype.json = function () {
      probe.jsonReads.push(this.url);
      return json.call(this);
    };
    JSON.parse = function (text, reviver) {
      if (typeof text === "string" && text.length > 3000000)
        probe.largeJSON.push(text.length);
      return parse.call(this, text, reviver);
    };
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        probe.workers.created++;
      }
      terminate() {
        probe.workers.terminated++;
        return super.terminate();
      }
    };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        probe.longtasks.push({
          start: entry.startTime,
          duration: entry.duration,
        });
    }).observe({ type: "longtask", buffered: true });
    new MutationObserver(() => {
      if (
        probe.ready === null &&
        document.getElementById("map")?.dataset.ready === "true"
      )
        probe.ready = performance.now();
    }).observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-ready"],
    });
  });
}
export async function observation(page) {
  return page.evaluate(() => ({
    ...window.__loadingProbe,
    at: performance.now(),
    timeOrigin: performance.timeOrigin,
    navigation: performance
      .getEntriesByType("navigation")
      .map((e) => e.toJSON()),
    resources: performance.getEntriesByType("resource").map((e) => e.toJSON()),
    labels: document.querySelectorAll(".country-label").length,
  }));
}
