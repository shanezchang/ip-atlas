import assert from "node:assert/strict";
import { test } from "node:test";

// Import the real filters without ever initializing the production SDK.
Object.defineProperty(globalThis, "location", {
  value: { hostname: "localhost", protocol: "http:" },
  configurable: true,
});
Object.defineProperty(globalThis, "navigator", {
  value: { doNotTrack: null },
  configurable: true,
});
const { analyticsAllowed, sanitizeEvent } =
  await import("../../web/src/analytics.ts");
const production = { hostname: "plotip.vercel.app", protocol: "https:" };

test("analytics is restricted to the HTTPS production host", () => {
  assert.equal(analyticsAllowed(production, {}), true);
  for (const hostname of [
    "localhost",
    "127.0.0.1",
    "plotip-preview.vercel.app",
    "plotip.vercel.app.example.org",
  ])
    assert.equal(analyticsAllowed({ ...production, hostname }, {}), false);
  assert.equal(
    analyticsAllowed({ ...production, protocol: "http:" }, {}),
    false,
  );
});

test("DNT and GPC independently disable analytics", () => {
  assert.equal(analyticsAllowed(production, { doNotTrack: "1" }), false);
  assert.equal(
    analyticsAllowed(production, { globalPrivacyControl: true }),
    false,
  );
});

test("homepage pageviews strip queries and fragments without mutating input", () => {
  const event = {
    type: "pageview",
    url: "https://plotip.vercel.app/?ip=192.0.2.1#private-result",
  };
  assert.deepEqual(sanitizeEvent(event), {
    type: "pageview",
    url: "https://plotip.vercel.app/",
  });
  assert.match(event.url, /192\.0\.2\.1/);
});

test("custom events cannot collect IPs or range selections", () => {
  assert.equal(
    sanitizeEvent({
      type: "event",
      url: "https://plotip.vercel.app/",
      name: "lookup",
      data: { ip: "192.0.2.1" },
    }),
    null,
  );
});

test("API, private paths, other hosts and malformed URLs never become pageviews", () => {
  for (const url of [
    "https://plotip.vercel.app/api/lookup?ip=192.0.2.1",
    "https://plotip.vercel.app/results/192.0.2.1",
    "https://example.org/",
    "http://plotip.vercel.app/",
    "not-a-url",
  ])
    assert.equal(sanitizeEvent({ type: "pageview", url }), null);
});
