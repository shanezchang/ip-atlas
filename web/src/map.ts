import * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import type { FeatureCollection, LineString } from "geojson";
import type { Area, Result, Lang } from "./types";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
maplibregl.setWorkerUrl(workerUrl);

const grid: FeatureCollection<LineString> = {
  type: "FeatureCollection",
  features: [],
};
for (let x = -180; x <= 180; x += 30)
  grid.features.push({
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: [
        [x, -85],
        [x, 85],
      ],
    },
  });
for (let y = -60; y <= 60; y += 30)
  grid.features.push({
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: Array.from({ length: 37 }, (_, i) => [-180 + i * 10, y]),
    },
  });

export class PlotipMap {
  private map?: maplibregl.Map;
  private markers: maplibregl.Marker[] = [];
  private labels: {
    marker: maplibregl.Marker;
    zh: string;
    en: string;
    rank: number;
  }[] = [];
  private results: Result[] = [];
  private active?: Result;
  private lang: Lang = "zh";
  private ready = false;
  private dark = false;
  private area?: Area;
  private level: "country" | "region" = "country";
  constructor(
    private onSelect: (r: Result) => void,
    private onArea: (area: Area) => void,
    private onOcean: () => void,
  ) {}
  async init(dark: boolean) {
    this.dark = dark;
    try {
      const response = await fetch("/world.geojson");
      if (!response.ok) throw new Error("Map unavailable");
      const world = await response.json();
      const style: StyleSpecification = {
        version: 8,
        transition: { duration: 0, delay: 0 },
        sources: {
          regions: { type: "geojson", data: "/regions.geojson" },
          world: { type: "geojson", data: world },
          grid: { type: "geojson", data: grid },
          active: {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          },
        },
        layers: [
          {
            id: "water",
            type: "background",
            paint: { "background-color": "#e9edf5" },
          },
          {
            id: "grid",
            type: "line",
            source: "grid",
            paint: {
              "line-color": "#bdc7db",
              "line-width": 0.6,
              "line-opacity": 0.25,
              "line-dasharray": [2, 5],
            },
          },
          {
            id: "land",
            type: "fill",
            source: "world",
            paint: { "fill-color": "#fbfcff" },
          },
          {
            id: "borders",
            type: "line",
            source: "world",
            paint: { "line-color": "#bdc7db", "line-width": 0.65 },
          },
          {
            id: "regions",
            type: "line",
            source: "regions",
            minzoom: 2.5,
            paint: {
              "line-color": "#bdc7db",
              "line-width": 0.65,
              "line-opacity": 0.65,
            },
          },
          {
            id: "regions-hit",
            type: "fill",
            source: "regions",
            paint: { "fill-opacity": 0 },
          },
          {
            id: "hover-country",
            type: "fill",
            source: "world",
            filter: ["==", ["get", "code"], ""],
            paint: { "fill-color": "#315be8", "fill-opacity": 0.08 },
          },
          {
            id: "hover-region",
            type: "fill",
            source: "regions",
            filter: ["==", ["get", "id"], ""],
            paint: { "fill-color": "#315be8", "fill-opacity": 0.08 },
          },
          {
            id: "selected",
            type: "fill",
            source: "world",
            filter: ["==", ["get", "code"], ""],
            paint: { "fill-color": "#315be8", "fill-opacity": 0.06 },
          },
          {
            id: "selected-region",
            type: "fill",
            source: "regions",
            filter: ["==", ["get", "id"], ""],
            paint: { "fill-color": "#315be8", "fill-opacity": 0.12 },
          },
          {
            id: "region-outline",
            type: "line",
            source: "regions",
            filter: ["==", ["get", "id"], ""],
            paint: { "line-color": "#315be8", "line-width": 1.6 },
          },
          {
            id: "selected-outline",
            type: "line",
            source: "world",
            filter: ["==", ["get", "code"], ""],
            paint: {
              "line-color": "#315be8",
              "line-width": 1.1,
              "line-opacity": 0.7,
            },
          },
        ],
      };
      this.map = new maplibregl.Map({
        container: "map",
        style,
        center: [65, 24],
        zoom: 1.25,
        minZoom: 0.6,
        maxZoom: 5.5,
        renderWorldCopies: false,
        attributionControl: false,
        dragRotate: false,
        touchPitch: false,
        pitchWithRotate: false,
        canvasContextAttributes: { antialias: true },
      });
      this.map.touchZoomRotate.disableRotation();
      this.map.setPadding(this.padding());
      this.map.on("load", () => {
        this.ready = true;
        for (const f of world.features) {
          const p = f.properties;
          if (p.rank > 5 || p.code === "AQ") continue;
          const zh =
            p.code?.length === 2
              ? new Intl.DisplayNames(["zh"], { type: "region" }).of(p.code) ||
                p.zh
              : p.zh;
          const en =
            p.code?.length === 2
              ? new Intl.DisplayNames(["en"], { type: "region" }).of(p.code) ||
                p.name
              : p.name;
          const label = document.createElement("span");
          label.className = "country-label";
          label.textContent = this.lang === "zh" ? zh : en;
          const marker = new maplibregl.Marker({ element: label })
            .setLngLat([p.lon, p.lat])
            .addTo(this.map!);
          this.labels.push({ marker, zh, en, rank: p.rank });
        }
        this.labels.sort(
          (a, b) => a.rank - b.rank || a.en.localeCompare(b.en, "en"),
        );
        void document.fonts.ready.then(() => this.updateLabels());
        this.theme(this.dark);
        this.updateLabels();
        this.render();
        if (this.area) this.focusArea(this.area);
        else if (this.active?.location) this.focus(this.active);
        document.getElementById("map-loading")!.hidden = true;
        document.getElementById("map")!.dataset.ready = "true";
      });
      // DOM markers do not participate in MapLibre symbol collision placement.
      // Render follows camera/marker updates, including pan, zoom and resize.
      this.map.on("render", () => this.updateLabels());
      this.map.on("resize", () => {
        if (this.area) this.focusArea(this.area);
        else if (this.active?.location) this.focus(this.active);
        else this.map?.setPadding(this.padding());
      });
      this.map.on("click", (event) => {
        const area = this.pick(event.point);
        if (area) this.onArea(area);
        else this.onOcean();
      });
      this.map.on("mouseout", () => this.clearHover());
      this.map.on("mousemove", (event) => {
        const area = this.pick(event.point);
        this.map!.getCanvas().style.cursor = area ? "pointer" : "";
        const hover = document.getElementById("map-hover")!;
        hover.hidden = !area;
        if (area)
          hover.textContent =
            this.lang === "zh" ? area.zh || area.name : area.name;
        this.map!.setFilter("hover-country", [
          "==",
          ["get", "code"],
          area?.level === "country" ? area.country_code : "",
        ]);
        this.map!.setFilter("hover-region", [
          "==",
          ["get", "id"],
          area?.level === "region" ? area.id.slice(7) : "",
        ]);
        document.getElementById("map-coordinates")!.textContent =
          `${Math.abs(event.lngLat.lat).toFixed(1)}° ${event.lngLat.lat >= 0 ? "N" : "S"}   ${Math.abs(event.lngLat.lng).toFixed(1)}° ${event.lngLat.lng >= 0 ? "E" : "W"}`;
      });
      this.map.on("error", () => this.failure());
      document.getElementById("zoom-in")!.onclick = () => this.map?.zoomIn();
      document.getElementById("zoom-out")!.onclick = () => this.map?.zoomOut();
      document.getElementById("reset-map")!.onclick = () => this.overview();
    } catch {
      this.failure();
    }
  }
  setLevel(level: "country" | "region") {
    this.level = level;
    this.clearHover();
  }
  private clearHover() {
    if (!this.ready || !this.map) return;
    document.getElementById("map-hover")!.hidden = true;
    this.map.setFilter("hover-country", ["==", ["get", "code"], ""]);
    this.map.setFilter("hover-region", ["==", ["get", "id"], ""]);
  }
  private pick(point: maplibregl.Point): Area | undefined {
    if (!this.ready || !this.map) return;
    const feature = this.map.queryRenderedFeatures(point, {
      layers: [this.level === "country" ? "land" : "regions-hit"],
    })[0];
    const p = feature?.properties;
    if (!p || !/^[A-Z]{2}$/.test(p.code)) return;
    return {
      id: this.level === "country" ? `country:${p.code}` : `region:${p.id}`,
      level: this.level,
      country_code: p.code,
      name: p.name,
      zh: p.zh,
      bounds: typeof p.bounds === "string" ? JSON.parse(p.bounds) : p.bounds,
    };
  }
  selectArea(area: Area) {
    this.area = area;
    this.render();
    if (this.ready) this.focusArea(area);
  }
  private focusArea(area: Area) {
    const [w, s, e, n] = area.bounds;
    this.map?.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      {
        padding: this.padding(),
        absolutePadding: true,
        maxZoom: 5,
        duration: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 500,
      },
    );
  }
  private failure() {
    const el = document.getElementById("map-loading")!;
    el.hidden = false;
    el.textContent =
      this.lang === "zh"
        ? "地图暂时无法显示，仍可查询 IP。"
        : "Map unavailable. IP lookup still works.";
  }
  private updateLabels() {
    if (!this.ready || !this.map) return;
    const z = this.map.getZoom();
    const viewport = this.map.getContainer().getBoundingClientRect();
    const gap = 8;
    const overlaps = (a: DOMRect, b: DOMRect) =>
      a.left < b.right + gap &&
      a.right + gap > b.left &&
      a.top < b.bottom + gap &&
      a.bottom + gap > b.top;
    const occupied = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".rail, .map-heading, .map-controls, .map-footer, .map-pin, .pin-label",
      ),
      (el) => el.getBoundingClientRect(),
    ).filter((r) => r.width && r.height);
    // Read all text bounds before writing visibility. Hidden labels retain their
    // dimensions so a pan, translation or font load can make them visible again.
    const placements = this.labels.map(({ marker, rank }) => {
      const element = marker.getElement();
      const box = element.getBoundingClientRect();
      const visible =
        rank <= (z < 1.7 ? 2 : z < 2.5 ? 3 : 5) &&
        box.left >= viewport.left + gap &&
        box.right <= viewport.right - gap &&
        box.top >= viewport.top + gap &&
        box.bottom <= viewport.bottom - gap &&
        !occupied.some((r) => overlaps(box, r));
      if (visible) occupied.push(box);
      return { element, visible };
    });
    for (const { element, visible } of placements)
      element.style.visibility = visible ? "visible" : "hidden";
  }
  language(lang: Lang) {
    this.lang = lang;
    this.labels.forEach(
      (x) => (x.marker.getElement().textContent = lang === "zh" ? x.zh : x.en),
    );
    this.render();
    this.updateLabels();
  }
  theme(dark: boolean) {
    this.dark = dark;
    if (!this.ready || !this.map) return;
    for (const [id, prop, color] of [
      ["water", "background-color", dark ? "#191e2a" : "#e9edf5"],
      ["land", "fill-color", dark ? "#2a3245" : "#fbfcff"],
      ["borders", "line-color", dark ? "#4a5874" : "#bdc7db"],
      ["regions", "line-color", dark ? "#4a5874" : "#bdc7db"],
      ["grid", "line-color", dark ? "#4a5874" : "#bdc7db"],
      ["selected", "fill-color", dark ? "#a4b7ff" : "#315be8"],
      ["selected-outline", "line-color", dark ? "#a4b7ff" : "#315be8"],
      ["selected-region", "fill-color", dark ? "#a4b7ff" : "#315be8"],
      ["region-outline", "line-color", dark ? "#a4b7ff" : "#315be8"],
    ])
      this.map.setPaintProperty(
        id,
        prop as "background-color" | "fill-color" | "line-color",
        color,
      );
  }
  update(results: Result[], active?: Result, fly = true) {
    this.area = undefined;
    this.results = results;
    this.active = active;
    this.render();
    if (fly && active?.location && this.ready) this.focus(active);
    else if (fly && active && !active.location) this.overview();
  }
  private padding() {
    const desktop = window.innerWidth > 700;
    const rail = document.querySelector(".rail")!.getBoundingClientRect();
    return {
      top: 72,
      bottom: 72,
      left: desktop ? Math.ceil(rail.right) + 32 : 40,
      right: 64,
    };
  }
  private focus(r: Result) {
    if (!r.location || !this.map) return;
    const options = {
      padding: this.padding(),
      duration: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : 500,
    };
    if (r.location.bounds) {
      const [w, s, e, n] = r.location.bounds;
      this.map.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        { ...options, absolutePadding: true, maxZoom: 5 },
      );
    } else {
      this.map.flyTo({
        ...options,
        center: [r.location.longitude, r.location.latitude],
        zoom: 4.6,
      });
    }
  }
  overview() {
    this.map?.flyTo({
      center: [65, 24],
      zoom: 1.25,
      padding: this.padding(),
      duration: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : 450,
    });
  }
  private render() {
    if (!this.ready || !this.map) return;
    this.markers.forEach((m) => m.remove());
    this.markers = [];
    for (const r of this.area ? [] : [...this.results].reverse()) {
      if (!r.location) continue;
      const selected = r.ip === this.active?.ip;
      const button = document.createElement("button");
      button.className = `map-pin${selected ? " selected" : ""}`;
      button.setAttribute(
        "aria-label",
        `${r.ip} · ${r.city || r.region || r.country}`,
      );
      const dot = document.createElement("span");
      dot.className = "pin-dot";
      button.append(dot);
      if (selected) {
        const label = document.createElement("span");
        label.className = "pin-label";
        label.textContent =
          this.lang === "en"
            ? r.location.name
            : (r.location.level === "city"
                ? r.city
                : r.location.level === "region"
                  ? r.region
                  : r.country) || r.location.name;
        button.append(label);
      }
      button.onclick = (event) => {
        event.stopPropagation();
        this.onSelect(r);
      };
      this.markers.push(
        new maplibregl.Marker({ element: button, anchor: "center" })
          .setLngLat([r.location.longitude, r.location.latitude])
          .addTo(this.map),
      );
    }
    for (const layer of ["selected-region", "region-outline"])
      this.map.setFilter(layer, [
        "==",
        ["get", "id"],
        this.area
          ? this.area.level === "region"
            ? this.area.id.slice(7)
            : ""
          : this.active?.location?.region_id || "",
      ]);
    for (const layer of ["selected", "selected-outline"])
      this.map.setFilter(layer, [
        "==",
        ["get", "code"],
        this.area?.country_code ||
          (this.active?.location ? this.active.country_code || "" : ""),
      ]);
  }
}
