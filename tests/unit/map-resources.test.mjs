import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareMapResources } from "../../web/src/map-resources.ts";

const world = { type: "FeatureCollection", features: [] };
function controlled(t) {
  const nativeFetch = globalThis.fetch;
  const requests = [];
  t.mock.method(
    globalThis,
    "fetch",
    (url, options) =>
      new Promise((resolve) => {
        requests.push({ url, signal: options.signal, resolve });
      }),
  );
  const created = [],
    revoked = [];
  const create = URL.createObjectURL,
    revoke = URL.revokeObjectURL;
  t.mock.method(URL, "createObjectURL", (blob) => {
    const url = create(blob);
    created.push(url);
    return url;
  });
  t.mock.method(URL, "revokeObjectURL", (url) => {
    revoked.push(url);
    revoke(url);
  });
  t.after(() => created.forEach(revoke));
  return { requests, created, revoked, nativeFetch };
}

test("resource downloads start together and hand unchanged regions bytes to one Blob URL", async (t) => {
  const { requests, created, nativeFetch } = controlled(t);
  const resources = prepareMapResources();
  assert.deepEqual(
    requests.map((r) => r.url),
    ["/world.geojson", "/regions.geojson"],
  );
  assert.equal(requests[0].signal, requests[1].signal);
  requests[1].resolve(
    new Response('{"type":"FeatureCollection","features":[]}'),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(created.length, 0, "world must also be complete");
  requests[0].resolve(Response.json(world));
  const ready = await resources.ready;
  assert.deepEqual(ready.world, world);
  assert.equal(created.length, 1);
  assert.equal(
    await (await nativeFetch(ready.regionsUrl)).text(),
    '{"type":"FeatureCollection","features":[]}',
  );
  resources.dispose();
});

test("dispose after readiness revokes the temporary URL exactly once", async (t) => {
  const { requests, created, revoked, nativeFetch } = controlled(t);
  const resources = prepareMapResources();
  requests[0].resolve(Response.json(world));
  requests[1].resolve(Response.json(world));
  const ready = await resources.ready;
  ready.dispose();
  resources.dispose();
  assert.deepEqual(revoked, created);
  assert.equal(revoked.length, 1);
  assert.equal(requests[0].signal.aborted, true);
  await assert.rejects(nativeFetch(ready.regionsUrl));
});

test("early disposal cannot create a late orphan URL even if transport ignores abort", async (t) => {
  const { requests, created } = controlled(t);
  const resources = prepareMapResources();
  const rejected = assert.rejects(resources.ready, { name: "AbortError" });
  resources.dispose();
  requests[0].resolve(Response.json(world));
  requests[1].resolve(Response.json(world));
  await rejected;
  assert.equal(
    requests.every((r) => r.signal.aborted),
    true,
  );
  assert.deepEqual(created, []);
});

for (const fault of ["world-http", "regions-http", "world-json"])
  test(`${fault} rejects to the owner which cancels both requests without creating a URL`, async (t) => {
    const { requests, created } = controlled(t);
    const resources = prepareMapResources();
    const handled = resources.ready.catch((error) => {
      resources.dispose();
      throw error;
    });
    const rejected = assert.rejects(handled);
    requests[0].resolve(
      fault === "world-http"
        ? new Response("", { status: 503 })
        : fault === "world-json"
          ? new Response("{invalid")
          : Response.json(world),
    );
    requests[1].resolve(
      fault === "regions-http"
        ? new Response("", { status: 503 })
        : Response.json(world),
    );
    await rejected;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      requests.every((r) => r.signal.aborted),
      true,
    );
    assert.deepEqual(created, []);
  });
