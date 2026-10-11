import type { FeatureCollection, Geometry } from "geojson";

type World = FeatureCollection<
  Geometry,
  {
    code: string;
    rank: number;
    zh: string;
    name: string;
    lon: number;
    lat: number;
  }
>;
// Self-contained so the same check can run inside MapLibre's existing worker.
// This is the shape consumed by Plotip, not a general GeoJSON/topology validator.
export function assertMapCollection(
  data: unknown,
  source: "world" | "regions",
): void {
  const record = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  const finite = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v);
  const text = (v: unknown): v is string =>
    typeof v === "string" && v.length > 0;
  const position = (v: unknown) =>
    Array.isArray(v) &&
    v.length >= 2 &&
    v.every(finite) &&
    v[1] >= -90 &&
    v[1] <= 90;
  const ring = (v: unknown) =>
    Array.isArray(v) &&
    v.length >= 4 &&
    v.every(position) &&
    v[0][0] === v[v.length - 1][0] &&
    v[0][1] === v[v.length - 1][1];
  const polygon = (v: unknown) =>
    Array.isArray(v) && v.length > 0 && v.every(ring);
  const geometry = (v: unknown) =>
    record(v) &&
    (v.type === "Polygon"
      ? polygon(v.coordinates)
      : v.type === "MultiPolygon" &&
        Array.isArray(v.coordinates) &&
        v.coordinates.length > 0 &&
        v.coordinates.every(polygon));
  if (
    !record(data) ||
    data.type !== "FeatureCollection" ||
    !Array.isArray(data.features) ||
    (source === "regions" && data.features.length === 0)
  )
    throw new Error("Map unavailable");
  for (const feature of data.features) {
    if (
      !record(feature) ||
      feature.type !== "Feature" ||
      !record(feature.properties) ||
      !geometry(feature.geometry)
    )
      throw new Error("Map unavailable");
    const p = feature.properties;
    const bounds = p.bounds;
    if (
      !text(p.code) ||
      !Array.isArray(bounds) ||
      bounds.length !== 4 ||
      !bounds.every(finite) ||
      bounds[0] > bounds[2] ||
      bounds[1] > bounds[3] ||
      bounds[1] < -90 ||
      bounds[3] > 90
    )
      throw new Error("Map unavailable");
    if (source === "world") {
      if (
        typeof p.name !== "string" ||
        typeof p.zh !== "string" ||
        (p.code.length === 2 && !/^[A-Z]{2}$/.test(p.code)) ||
        !finite(p.rank) ||
        !finite(p.lon) ||
        !finite(p.lat) ||
        p.lat < -90 ||
        p.lat > 90
      )
        throw new Error("Map unavailable");
    } else if (
      !text(p.id) ||
      !(typeof p.name === "string" || p.name === null) ||
      !(typeof p.zh === "string" || p.zh === null)
    ) {
      // The generated regions asset contains explicitly unnamed islands.
      throw new Error("Map unavailable");
    }
  }
}

export type MapResources = {
  world: World;
  regionsUrl: string;
  dispose: () => void;
};

// Start both downloads alongside the lazy map import. Keep regions as bytes:
// MapLibre's existing worker parses the Blob URL, not the main thread, and no
// second HTTP request or HTTP-cache reuse is needed (including routed QA).
export function prepareMapResources() {
  const controller = new AbortController();
  let regionsUrl: string | undefined;
  const dispose = () => {
    controller.abort();
    if (regionsUrl) {
      URL.revokeObjectURL(regionsUrl);
      regionsUrl = undefined;
    }
  };
  const fetchResource = async (url: string) => {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error("Map unavailable");
    return response;
  };
  const ready = Promise.all([
    fetchResource("/world.geojson").then(async (response) => {
      const world: unknown = await response.json();
      assertMapCollection(world, "world");
      return world as World;
    }),
    fetchResource("/regions.geojson").then((response) => response.blob()),
  ]).then(([world, regions]) => {
    controller.signal.throwIfAborted();
    regionsUrl = URL.createObjectURL(regions);
    return { world, regionsUrl, dispose };
  });
  return { ready, dispose };
}
