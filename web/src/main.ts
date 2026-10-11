import "@fontsource-variable/manrope";
import "@fontsource/ibm-plex-mono/400.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import "./analytics";
import {
  createElement,
  Search,
  ArrowUpRight,
  LocateFixed,
  Copy,
  Check,
  Plus,
  Minus,
  Globe2,
  Moon,
  Sun,
  X,
  CodeXml,
  ArrowRight,
  Info,
} from "lucide";
import type { PlotipMap } from "./map";
import type { Area, Lang, Result } from "./types";
import { RangePanel } from "./ranges";
import { prepareMapResources } from "./map-resources";

const icons = {
  Search,
  ArrowUpRight,
  LocateFixed,
  Copy,
  Check,
  Plus,
  Minus,
  Globe2,
  Moon,
  Sun,
  X,
  Github: CodeXml,
  ArrowRight,
  Info,
};
const icon = (name: keyof typeof icons) =>
  createElement(icons[name], {
    width: 18,
    height: 18,
    "stroke-width": 1.7,
    "aria-hidden": "true",
  }).outerHTML;
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const stored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const persist = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage is optional. */
  }
};
let lang: Lang =
  (stored("plotip-lang") ?? stored("atlas-lang")) === "zh" ? "zh" : "en";
// Preserve preferences saved before the Plotip rename.
const savedTheme = stored("plotip-theme") ?? stored("atlas-theme");
let dark = savedTheme
  ? savedTheme === "dark"
  : matchMedia("(prefers-color-scheme: dark)").matches;
let active: Result | undefined;
let history: Result[] = [];
let request: AbortController | undefined;
let inputRevision = 0;
let busy = false;
let copyTimer: ReturnType<typeof setTimeout> | undefined;
const text = {
  zh: {
    tagline: "这个 IP，来自哪里？",
    intro: "",
    label: "IP 地址",
    placeholder: "输入 IPv4 或 IPv6 地址",
    search: "查询",
    my: "查询我的 IP",
    try: "试试看",
    examples: ["南京", "加利福尼亚", "深圳 · IPv6"],
    emptyTitle: "把地址放回地图。",
    emptyBody: "输入 IP，或点击地图查看地区 IP 段。",
    recent: "本次查询",
    clear: "清空",
    emptyRecent: "查询过的地址会留在这里。",
    world: "世界地图",
    overview: "查看全图",
    zoomIn: "放大",
    zoomOut: "缩小",
    loadingMap: "正在展开地图…",
    mapNote: "地图展示地域参考位置",
    country: "国家 / 地区",
    region: "省 / 州",
    city: "城市",
    isp: "运营商",
    unknown: "暂无数据",
    copy: "复制结果",
    copied: "已复制",
    copyFailed: "未能复制，请手动选择结果。",
    querying: "正在查询…",
    invalid: "请输入有效的 IPv4 或 IPv6 地址。",
    network: "查询暂时失败，请稍后重试。",
    timeout: "查询超时，请重试。",
    privateTitle: "非公网地址",
    privateBody: "这个地址没有可查询的公网归属地，因此不会在地图上标记。",
    unmappedTitle: "暂无归属地",
    unmappedBody: "当前数据库没有这条地址的归属地记录。",
    noPoint: "归属地已找到，暂无可靠的地图坐标。",
    cityNote: "标记为城市中心，并非设备的实际位置。",
    regionNote: "标记为省 / 州参考位置，并非设备的实际位置。",
    countryNote: "标记为国家 / 地区参考位置，并非设备的实际位置。",
    cityBadge: "城市参考位置",
    regionBadge: "省 / 州参考位置",
    countryBadge: "国家 / 地区参考位置",
    about: "关于与数据来源",
    aboutTitle: "关于 Plotip",
    aboutLead: "让一串 IP 地址，在地图上有迹可循。",
    aboutBody:
      "Plotip 是一个开源的 IP 归属地查询工具。查询在服务端完成；本次查询历史只保存在当前浏览器标签页中，关闭标签页后清除。无需注册，也不会下载 IP 数据库到浏览器。",
    accuracy:
      "IP 归属地不等于设备位置。代理、VPN、网络出口和数据更新延迟都会影响结果；地图显示的是匹配地域的参考坐标。",
    sources: "数据来源",
    data: "IP 数据：ip2region 开源数据库。坐标：GeoNames（CC BY 4.0）与 Natural Earth（公有领域）。底图：Natural Earth，边界沿用其数据表达。",
    privacy:
      "本站使用无 Cookie 的 Vercel Web Analytics 统计访问量、来源和设备，尊重 DNT/GPC 设置。查询的 IP 和结果不作为统计事件发送；平台可能保留基础访问日志。",
    close: "关闭",
    theme: "切换明暗主题",
    openSource: "开源代码",
    local: "历史仅保存在本标签页",
    result: "查询结果",
  },
  en: {
    tagline: "Where does this IP live?",
    intro: "",
    label: "IP address",
    placeholder: "Enter an IPv4 or IPv6 address",
    search: "Look up",
    my: "Find my IP",
    try: "Try an address",
    examples: ["Nanjing", "California", "Shenzhen · IPv6"],
    emptyTitle: "A world behind the numbers.",
    emptyBody:
      "Look up an address, or click the map to explore regional IP ranges.",
    recent: "This session",
    clear: "Clear",
    emptyRecent: "Your lookups will appear here.",
    world: "World map",
    overview: "World view",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    loadingMap: "Unfolding the map…",
    mapNote: "Map shows approximate regional locations",
    country: "Country / territory",
    region: "Region / state",
    city: "City",
    isp: "Network",
    unknown: "Not available",
    copy: "Copy result",
    copied: "Copied",
    copyFailed: "Could not copy. Select the result manually.",
    querying: "Looking up…",
    invalid: "Enter a valid IPv4 or IPv6 address.",
    network: "Lookup unavailable. Please try again.",
    timeout: "Lookup timed out. Please try again.",
    privateTitle: "Non-public address",
    privateBody:
      "This address has no public geographic location, so it is not placed on the map.",
    unmappedTitle: "No location found",
    unmappedBody:
      "This address has no location record in the current database.",
    noPoint: "Region found, but no reliable map coordinates are available.",
    cityNote: "The pin marks a city center, not the actual device location.",
    regionNote:
      "The pin marks a regional reference point, not the actual device location.",
    countryNote:
      "The pin marks a country reference point, not the actual device location.",
    cityBadge: "City reference point",
    regionBadge: "Region reference point",
    countryBadge: "Country reference point",
    about: "About & data sources",
    aboutTitle: "About Plotip",
    aboutLead: "Put an IP address in perspective.",
    aboutBody:
      "Plotip is an open-source IP geolocation tool. Lookups run on the server. History stays in your current browser tab and is cleared when the tab closes. No account or IP database download is needed.",
    accuracy:
      "IP geolocation is not device positioning. Proxies, VPNs, network gateways and aging records can affect results. Map coordinates represent the matched region.",
    sources: "Data sources",
    data: "IP data: ip2region open-source database. Coordinates: GeoNames (CC BY 4.0) and Natural Earth (public domain). Basemap: Natural Earth; boundaries follow its dataset.",
    privacy:
      "Vercel Web Analytics measures visits, referrers and devices without cookies and respects DNT/GPC. Queried IPs and results are not sent as analytics events. Hosting may retain basic access logs.",
    close: "Close",
    theme: "Toggle color theme",
    openSource: "Source code",
    local: "History stays in this tab",
    result: "Lookup result",
  },
};
const t = () => text[lang];
const sampleIPs = [
  "114.114.114.114",
  "8.8.8.8",
  "240e:3b7:3272:d8d0:db09:c067:8d59:539e",
];
try {
  const data = JSON.parse(sessionStorage.getItem("plotip-history-v2") || "[]");
  if (Array.isArray(data))
    history = data
      .filter(
        (r) =>
          r &&
          typeof r.ip === "string" &&
          typeof r.version === "number" &&
          typeof r.scope === "string",
      )
      .slice(0, 8);
} catch {
  /* Start clean. */
}

$("app").innerHTML = `
<a class="skip-link" href="#ip-input">${lang === "zh" ? "跳到查询" : "Skip to lookup"}</a>
<header class="masthead"><a class="brand" href="/" aria-label="Plotip"><img src="/favicon.svg" width="32" height="32" alt=""/><span class="brand-word">plotip</span><span class="brand-chinese">落点</span></a><span class="masthead-caption" id="header-caption"></span><nav aria-label="Site controls"><button id="lang" class="text-button">EN</button><button id="theme" class="icon-button"></button><a class="github-link" href="https://github.com/shanezchang/plotip" target="_blank" rel="noopener noreferrer">${icon("Github")}<span>GitHub</span>${icon("ArrowUpRight")}</a></nav></header>
<main class="workspace" id="workspace" data-mode="lookup"><aside class="rail"><div class="mode-switch" role="group" aria-label="Lookup mode"><button id="mode-lookup" aria-pressed="true"></button><button id="mode-ranges" aria-pressed="false"></button></div><section id="ranges-panel" class="ranges-panel" hidden></section><section class="query-section"><h1 id="tagline"></h1><p id="intro" class="intro"></p><form id="query-form" novalidate><label for="ip-input" id="input-label"></label><div class="input-wrap"><input id="ip-input" name="ip" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="64" aria-describedby="error" required/><kbd>/</kbd></div><div class="query-actions"><button type="submit" id="submit" class="primary"></button><button type="button" id="my-ip" class="secondary"></button></div><p id="error" class="error" role="alert" hidden></p><p id="status" class="sr-only" role="status"></p></form><div class="examples"><span id="try-label"></span><div id="examples"></div></div></section><section id="result" class="result-section" aria-live="polite" aria-atomic="true"></section><section class="history-section"><div class="section-heading"><h2 id="recent-label"></h2><button id="clear-history" class="text-button"></button></div><div id="history"></div><p class="history-note" id="local-note"></p></section><footer class="rail-footer"><button id="about-button" class="text-button"></button><span>by <a href="https://github.com/shanezchang" target="_blank" rel="noopener noreferrer">Shane</a></span></footer></aside><section class="map-panel" aria-label="Interactive world map"><div id="map"></div><div class="map-heading"><label id="map-level-label" for="map-level"></label><select id="map-level"><option value="country"></option><option value="region"></option></select></div><div id="map-hover" hidden></div><div id="map-loading" role="status"></div><div class="map-controls"><button id="reset-map" class="icon-button">${icon("Globe2")}</button><div class="zoom-controls"><button id="zoom-in" class="icon-button">${icon("Plus")}</button><button id="zoom-out" class="icon-button">${icon("Minus")}</button></div></div><div class="map-footer"><span id="map-coordinates">30° N &nbsp; 60° E</span><span id="map-note"></span><a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a></div></section></main>
<dialog id="about-dialog" aria-labelledby="about-title"><button id="close-dialog" class="icon-button dialog-close">${icon("X")}</button><div id="about-content"></div></dialog><div id="toast" role="status" hidden></div>`;

let mapView: PlotipMap | undefined;
let mode: "lookup" | "ranges" = "lookup";
let selectedArea: Area | undefined;
const rangePanel = new RangePanel(
  $("ranges-panel"),
  (area) => {
    selectedArea = area;
    $<HTMLSelectElement>("map-level").value = area.level;
    mapView?.setLevel(area.level);
    mapView?.selectArea(area);
  },
  (ip) => {
    showMode("lookup");
    $<HTMLInputElement>("ip-input").value = ip;
    $("ip-input").focus();
    void query(ip);
  },
  toast,
);
function showMode(next: "lookup" | "ranges", area?: Area) {
  mode = next;
  $("workspace").dataset.mode = next;
  $("mode-lookup").setAttribute("aria-pressed", String(next === "lookup"));
  $("mode-ranges").setAttribute("aria-pressed", String(next === "ranges"));
  $("ranges-panel").hidden = next !== "ranges";
  if (next === "ranges") {
    request?.abort();
    request = undefined;
    setBusy(false);
    void rangePanel.open(area);
  } else {
    rangePanel.suspend();
    mapView?.update(history, active);
  }
}
$("mode-lookup").onclick = () => showMode("lookup");
$("mode-ranges").onclick = () => showMode("ranges");
$("map-level").onchange = () =>
  mapView?.setLevel(
    $<HTMLSelectElement>("map-level").value as "country" | "region",
  );
function placeTitle(r: Result): string {
  if (lang === "en" && r.location?.level === "city") return r.location.name;
  return r.city || r.region || r.country || t().unmappedTitle;
}
function fields(r: Result) {
  return [[t().isp, r.isp]]
    .filter(([, value]) => Boolean(value))
    .map(
      ([label, value]) =>
        `<div class="detail-row"><dt>${esc(label)}</dt><dd class="${value ? "" : "unavailable"}">${esc(value || t().unknown)}</dd></div>`,
    )
    .join("");
}
function renderResult() {
  if (!active) {
    $("result").innerHTML =
      `<div class="empty-orbit" aria-hidden="true"><img src="/favicon.svg" alt="" width="44" height="44"/></div><h2>${t().emptyTitle}</h2><p>${t().emptyBody}</p>`;
    $("result").classList.add("empty");
    return;
  }
  $("result").classList.remove("empty");
  const r = active;
  const special = r.scope !== "public";
  const level = r.location?.level;
  const note = level ? t()[`${level}Note`] : t().noPoint;
  $("result").innerHTML =
    `<div class="result-heading"><span class="version-badge">IPv${r.version}</span><span class="result-ip">${esc(r.ip)}</span><button id="copy-result" class="icon-button" aria-label="${t().copy}" title="${t().copy}">${icon("Copy")}</button></div><h2 class="place-title">${esc(special ? (r.scope === "unmapped" ? t().unmappedTitle : t().privateTitle) : placeTitle(r))}</h2>${special ? `<p class="result-note">${r.scope === "unmapped" ? t().unmappedBody : t().privateBody}</p>` : `<div class="place-context">${esc([r.country, r.region].filter((x, i, a) => x && a.indexOf(x) === i && x !== placeTitle(r)).join(" / "))}</div><dl class="details">${fields(r)}</dl><p class="location-note">${icon("Info")}<span>${note}</span></p>${r.location ? `<div class="coordinate-line"><span>${Math.abs(r.location.latitude).toFixed(2)}° ${r.location.latitude >= 0 ? "N" : "S"}</span><span>${Math.abs(r.location.longitude).toFixed(2)}° ${r.location.longitude >= 0 ? "E" : "W"}</span></div>` : ""}`}`;
  $("copy-result").onclick = async () => {
    const value = [
      r.ip,
      ...[r.country, r.region, r.city, r.isp].filter(Boolean),
    ].join(" | ");
    try {
      await navigator.clipboard.writeText(value);
      $("copy-result").innerHTML = icon("Check");
      toast(t().copied);
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        if (document.getElementById("copy-result"))
          $("copy-result").innerHTML = icon("Copy");
      }, 1600);
    } catch {
      toast(t().copyFailed);
    }
  };
}
function renderHistory() {
  $("clear-history").hidden = history.length === 0;
  $("history").innerHTML = history.length
    ? history
        .map(
          (r, i) =>
            `<button class="history-item${active?.ip === r.ip ? " active" : ""}" data-history="${i}" aria-pressed="${active?.ip === r.ip}"><span class="history-dot"></span><span><span class="history-ip">${esc(r.ip)}</span><span class="history-place">${esc(r.scope === "public" ? placeTitle(r) : t().privateTitle)}</span></span>${icon("ArrowUpRight")}</button>`,
        )
        .join("")
    : `<p class="history-empty">${t().emptyRecent}</p>`;
  document
    .querySelectorAll<HTMLButtonElement>("[data-history]")
    .forEach(
      (button) =>
        (button.onclick = () =>
          select(history[Number(button.dataset.history)])),
    );
}
function select(r: Result, updateInput = true) {
  active = r;
  if (updateInput) $<HTMLInputElement>("ip-input").value = r.ip;
  renderResult();
  renderHistory();
  mapView?.update(history, r);
}
function saveHistory() {
  try {
    sessionStorage.setItem("plotip-history-v2", JSON.stringify(history));
  } catch {
    /* Storage is optional. */
  }
}
function toast(message: string) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  setTimeout(() => ($("toast").hidden = true), 2300);
}
function setBusy(value: boolean) {
  busy = value;
  $<HTMLButtonElement>("submit").disabled = value;
  $<HTMLButtonElement>("my-ip").disabled = value;
  $("submit").innerHTML = value
    ? `<span class="spinner"></span>${t().querying}`
    : `${t().search}${icon("ArrowRight")}`;
  $("query-form").setAttribute("aria-busy", String(value));
  $("status").textContent = value ? t().querying : "";
}
async function query(value: string, own = false) {
  const input = $<HTMLInputElement>("ip-input");
  const draft = input.value;
  const revision = inputRevision;
  const isCurrentDraft = () =>
    inputRevision === revision && input.value === draft;
  request?.abort();
  const controller = new AbortController();
  request = controller;
  $("error").hidden = true;
  $("ip-input").removeAttribute("aria-invalid");
  if (!own && !value.trim()) {
    setBusy(false);
    showError(t().invalid);
    return;
  }
  setBusy(true);
  const timer = setTimeout(() => controller.abort("timeout"), 12000);
  try {
    const response = await fetch(own ? "/api/me" : "/api/lookup", {
      method: own ? "GET" : "POST",
      headers: own ? {} : { "Content-Type": "application/json" },
      body: own ? undefined : JSON.stringify({ ip: value.trim() }),
      signal: controller.signal,
    });
    if (controller !== request) return;
    if (!response.ok) {
      const invalid = response.status === 400 || response.status === 422;
      // Validation belongs to the submitted draft, not a subsequent edit.
      if (!invalid || isCurrentDraft())
        showError(invalid ? t().invalid : t().network);
      return;
    }
    const result: Result = await response.json();
    if (controller !== request) return;
    history = [result, ...history.filter((r) => r.ip !== result.ip)].slice(
      0,
      8,
    );
    saveHistory();
    select(result, isCurrentDraft());
    $("status").textContent =
      `${t().result}: ${result.ip}, ${placeTitle(result)}`;
  } catch {
    if (controller === request)
      showError(
        controller.signal.reason === "timeout" ? t().timeout : t().network,
      );
  } finally {
    clearTimeout(timer);
    if (controller === request) setBusy(false);
  }
}
function showError(message: string) {
  $("error").textContent = message;
  $("error").hidden = false;
  if (message === t().invalid) {
    $("ip-input").setAttribute("aria-invalid", "true");
    $("ip-input").focus();
  }
}
function renderLanguage() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.querySelector<HTMLElement>(".brand-chinese")!.hidden = lang !== "zh";
  document.title =
    lang === "zh"
      ? "落点 Plotip — IP 查询与地址段"
      : "Plotip — IP lookup & ranges";
  for (const [id, key] of Object.entries({
    tagline: "tagline",
    intro: "intro",
    "input-label": "label",
    "try-label": "try",
    "recent-label": "recent",
    "clear-history": "clear",
    "local-note": "local",
    "map-note": "mapNote",
    "about-button": "about",
  }))
    $(id).textContent = t()[key as keyof typeof text.zh] as string;
  $("mode-lookup").textContent = lang === "zh" ? "IP 查询" : "IP lookup";
  $("mode-ranges").textContent = lang === "zh" ? "IP 段" : "IP ranges";
  $("map-level-label").textContent =
    lang === "zh" ? "点击选区" : "Click to explore";
  const level = $<HTMLSelectElement>("map-level");
  level.options[0].text = lang === "zh" ? "国家 / 地区" : "Countries";
  level.options[1].text = lang === "zh" ? "省 / 州" : "States / provinces";
  rangePanel.language(lang);
  $("header-caption").textContent =
    lang === "zh" ? "IP 查询与地址段" : "IP lookup & ranges";
  $<HTMLInputElement>("ip-input").placeholder = t().placeholder;
  $("my-ip").innerHTML = `${icon("LocateFixed")}${t().my}`;
  $("lang").textContent = lang === "zh" ? "EN" : "中文";
  $("lang").setAttribute(
    "aria-label",
    lang === "zh" ? "Switch to English" : "切换到中文",
  );
  $("examples").innerHTML = sampleIPs
    .map(
      (ip, i) =>
        `<button class="example" data-ip="${ip}" title="${ip}">${t().examples[i]}${icon("ArrowUpRight")}</button>`,
    )
    .join("");
  document.querySelectorAll<HTMLButtonElement>("[data-ip]").forEach(
    (b) =>
      (b.onclick = () => {
        $<HTMLInputElement>("ip-input").value = b.dataset.ip!;
        void query(b.dataset.ip!);
      }),
  );
  for (const [id, key] of Object.entries({
    theme: "theme",
    "reset-map": "overview",
    "zoom-in": "zoomIn",
    "zoom-out": "zoomOut",
    "close-dialog": "close",
  })) {
    $(id).setAttribute(
      "aria-label",
      t()[key as keyof typeof text.zh] as string,
    );
    $(id).title = t()[key as keyof typeof text.zh] as string;
  }
  if (!$("map-loading").hidden) $("map-loading").textContent = t().loadingMap;
  $("about-content").innerHTML =
    `<img src="/favicon.svg" width="40" height="40" alt=""/><h2 id="about-title">${t().aboutTitle}</h2><p class="dialog-lead">${t().aboutLead}</p><p>${t().aboutBody}</p><p>${t().accuracy}</p><h3>${t().sources}</h3><p>${t().data}</p><div class="source-links"><a href="https://github.com/lionsoul2014/ip2region" target="_blank" rel="noopener noreferrer">ip2region</a><a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer">GeoNames</a><a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a></div><p class="privacy-note">${t().privacy}</p><a href="https://github.com/shanezchang/plotip" target="_blank" rel="noopener noreferrer">GitHub ${icon("ArrowUpRight")}</a>`;
  setBusy(busy);
  renderResult();
  renderHistory();
  mapView?.language(lang);
}
function applyTheme() {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  $("theme").innerHTML = icon(dark ? "Sun" : "Moon");
  mapView?.theme(dark);
}
$("ip-input").oninput = () => {
  inputRevision++;
};
$("query-form").onsubmit = (event) => {
  event.preventDefault();
  void query($<HTMLInputElement>("ip-input").value);
};
$("my-ip").onclick = () => void query("", true);
$("theme").onclick = () => {
  dark = !dark;
  persist("plotip-theme", dark ? "dark" : "light");
  applyTheme();
};
$("lang").onclick = () => {
  lang = lang === "zh" ? "en" : "zh";
  persist("plotip-lang", lang);
  $("error").hidden = true;
  renderLanguage();
};
$("clear-history").onclick = () => {
  request?.abort();
  request = undefined;
  setBusy(false);
  history = [];
  active = undefined;
  saveHistory();
  renderResult();
  renderHistory();
  mapView?.update([]);
  mapView?.overview();
  $("error").hidden = true;
};
const dialog = $<HTMLDialogElement>("about-dialog");
$("about-button").onclick = () => dialog.showModal();
$("close-dialog").onclick = () => dialog.close();
dialog.onclick = (e) => {
  if (e.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      dialog.close();
  }
};
document.addEventListener("keydown", (e) => {
  if (
    e.key === "/" &&
    !(e.target instanceof HTMLInputElement) &&
    !dialog.open
  ) {
    e.preventDefault();
    if (mode !== "lookup") showMode("lookup");
    $("ip-input").focus();
  }
});
renderLanguage();
applyTheme();
mapView?.update(history, undefined, false);
const mapResources = prepareMapResources();
void Promise.all([import("./map"), mapResources.ready])
  .then(([{ PlotipMap }, resources]) => {
    mapView = new PlotipMap(
      (r) => {
        showMode("lookup");
        select(r);
      },
      (area) => showMode("ranges", area),
      () =>
        toast(
          lang === "zh"
            ? "这里没有可选地区，请点击陆地。"
            : "No area here. Click a country or state on land.",
        ),
    );
    mapView.language(lang);
    mapView.update(history, active, false);
    if (mode === "ranges" && selectedArea) {
      mapView.setLevel(selectedArea.level);
      mapView.selectArea(selectedArea);
    }
    return mapView.init(dark, resources);
  })
  .catch(() => {
    mapResources.dispose();
    $("map-loading").textContent =
      lang === "zh"
        ? "地图暂时无法显示，仍可查询 IP。"
        : "Map unavailable. IP lookup still works.";
  });
