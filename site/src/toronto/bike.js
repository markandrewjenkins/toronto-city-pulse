// Bike Share Toronto: live station map (GBFS), 7-day trip forecast, riding patterns, busiest stations and routes.
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import * as d3 from "d3";
import { cssVar, el, tipRow, fmtInt } from "../shared/ui.js";
import { frame, gridY, colPath, renderBars, renderHeat, renderCompare, axisClean } from "../shared/charts.js";
import { dStats, dNote, dLink, dHead, href } from "../shared/console.js";
import { T, $, tip, fmt0, day, fDay, ordinal, loadData, barOpt, heatOpt, compareLegend, renderImportance, forecastCols, heatDrawer, route } from "./common.js";
import { pulse } from "./skin.js";

const GBFS = "https://tor.publicbikesystem.net/customer/gbfs/v2/en";
const MAP_STYLE = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" };
const D = () => T.D;
let map = null, started = false;
window.addEventListener("themechange", () => map?.setStyle(T.isDark() ? MAP_STYLE.dark : MAP_STYLE.light));

export const bike = {
  id: "bike", title: "Bike Share", color: "var(--bike)",
  eyebrow: "Bike Share Toronto", heading: "Bikes right now, and the week ahead",
  load: (ctx) => loadData(ctx).then(() => { startLive(); }),
  badge: () => [T.bikes ? fmtInt.format(d3.sum(T.bikes, (b) => b.bikes)) : T.bikeFailed ? "" : "…", "bikes docked right now"],
  kpis: () => {
    const B = T.bikes, tot = B ? d3.sum(B, (b) => b.bikes) : null, empty = B ? B.filter((b) => b.on && b.bikes === 0).length : null;
    const wk = d3.sum(D().bike.forecast, (x) => x.pred);
    return [
      ["Bikes docked now", B ? fmtInt.format(tot) : "—", B ? `${fmtInt.format(d3.sum(B, (b) => b.ebikes))} electric` : T.bikeFailed ? "live feed unavailable" : "loading live feed"],
      ["Stations", B ? fmtInt.format(B.length) : "—", B ? `${empty} empty right now` : ""],
      ["Trips next 7 days", d3.format(".3s")(wk), `${fmt0(D().bike.forecast[0].pred)} on ${fDay(day(D().bike.forecast[0].date)).slice(0, 3)}`],
      ["Trips since 2023", d3.format(".3s")(D().bike.total_trips), `through ${d3.timeFormat("%b %Y")(day(D().bike.data_through))}`],
    ];
  },
  tile: (t) => {
    const B = T.bikes;
    if (B) {
      t.status(`Live ${new Date(T.bikeTs * 1000).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}`);
      t.kpis([
        [fmtInt.format(d3.sum(B, (b) => b.bikes)), "bikes docked now"],
        [fmtInt.format(d3.sum(B, (b) => b.ebikes)), "of them electric"],
        [String(B.filter((b) => b.on && b.bikes === 0).length), `of ${fmtInt.format(B.length)} stations empty`],
      ]);
      tileMap(t.vis);
    } else {
      t.status(T.bikeFailed ? "Live feed offline" : "Connecting…");
      t.kpis([
        [d3.format(".3s")(d3.sum(D().bike.forecast, (x) => x.pred)), "trips forecast, next 7 days"],
        [fmt0(D().bike.forecast[0].pred), `trips ${fDay(day(D().bike.forecast[0].date))}`],
        [d3.format(".3s")(D().bike.total_trips), "trips since 2023"],
      ]);
      forecastCols(t.vis, D().bike.forecast, "--bike", "trips expected");
    }
  },
  subs: [
    { id: "live", title: "Live map", class: "pane-live", view: () => { ensureMap(); renderBikePanel(); }, html: `
      <div class="map-shell card">
        <div class="map-body">
          <div id="map" class="map"></div>
          <aside class="panel" id="bike-panel"><div class="note">Loading live availability…</div></aside>
        </div>
      </div>` },
    { id: "forecast", title: "Trip forecast", class: "pane-forecast",
      view: () => {
        renderBikeForecast();
        renderCompare("bike-bt", D().bike.backtest.map(([d_, o, p]) => ({ d: day(d_), o, p })), "--bike", "trips");
        compareLegend("bike-bt-legend", "--bike", "Actual trips");
        renderImportance("bike-imp", D().bike.importance, "--bike");
      }, html: `
      <div class="card cx-fill fc-main"><h3 class="cx-card-title">Trips forecast, next 7 days</h3><p class="note cx-card-sub" id="bike-fc-sub"></p><div class="chart" id="bike-fc"></div></div>
      <div class="card cx-fill fc-bt"><h3 class="cx-card-title">Forecast vs actual, recent test days</h3><div class="legend" id="bike-bt-legend"></div><div class="chart" id="bike-bt"></div></div>
      <div class="card cx-fill fc-imp"><h3 class="cx-card-title">What moves trips</h3><p class="note cx-card-sub">Extra error when each group of inputs is shuffled (trips per day).</p><div class="chart" id="bike-imp"></div></div>` },
    { id: "patterns", title: "When people ride", class: "pane-patterns",
      view: () => { renderHeat("bike-heat", D().bike.hourly, "--bike", (v) => `${fmt0(v)} trips`, heatOpt("bike", "patterns")); renderBikeMonthly(); }, html: `
      <div class="card cx-fill"><h3 class="cx-card-title">When Toronto rides</h3><p class="note cx-card-sub">Trips by hour and weekday since 2023. Commute peaks on weekdays, afternoon rides on weekends. Click a cell to compare that hour across the week.</p><div class="chart" id="bike-heat"></div></div>
      <div class="card cx-fill"><h3 class="cx-card-title">Trips per month</h3><p class="note cx-card-sub" id="bike-monthly-sub">Every trip in the open ridership files.</p><div class="chart" id="bike-monthly"></div></div>` },
    { id: "stations", title: "Stations & routes", short: "Stations", class: "pane-stations",
      view: () => {
        renderBars("bike-stations", D().bike.stations.map(([n, v]) => [n, v, n]), "--bike", (v) => fmt0(v), 200, barOpt("bike", "stations"));
        renderBars("bike-routes", D().bike.routes.map(([a, b, v], i) => [a === b ? `${a} (round trip)` : `${a} → ${b}`, v, `route-${i}`]), "--bike", (v) => fmt0(v), 260, barOpt("bike", "stations"));
      }, html: `
      <div class="cx-row cols-2">
        <div class="card cx-fill"><h3 class="cx-card-title">Busiest stations</h3><p class="note cx-card-sub">Trips started since 2023. Click a station for its live status.</p><div class="chart" id="bike-stations"></div></div>
        <div class="card cx-fill"><h3 class="cx-card-title">Most-ridden routes</h3><p class="note cx-card-sub">2023, 2024 and 2026. The City's 2025 trip files record every trip's end station as its start station, a source error, so 2025 is left out of this chart.</p><div class="chart" id="bike-routes"></div></div>
      </div>` },
  ],
  drawers: {
    patterns: (host, ctx, item) => heatDrawer(D().bike.hourly, "--bike", "Bike Share · when people ride", (v) => d3.format(".3s")(v), "trips since 2023")(host, ctx, item),
    live: (host, ctx, id) => {
      const b = bikeById(id);
      if (!b) return T.bikes || T.bikeFailed ? { kicker: "Bike Share · live station", title: "Station not found", body: [dNote("This station isn't in the live feed right now.")] } : { kicker: "Bike Share · live station", title: "Loading…", body: [liveBlock(null)] };
      const rank = D().bike.stations.findIndex(([n]) => norm(n) === norm(b.name));
      return { kicker: "Bike Share · live station", title: b.name, body: [liveBlock(b),
        rank >= 0 ? dNote(`The ${ordinal(rank + 1)} busiest station since 2023, with ${fmt0(D().bike.stations[rank][1])} trips started.`) : null,
        rank >= 0 ? dLink(href("bike", "stations", D().bike.stations[rank][0]), "See it among the busiest stations") : null] };
    },
    stations: (host, ctx, item) => {
      const m_ = /^route-(\d+)$/.exec(item);
      if (m_) {
        const r = D().bike.routes[+m_[1]]; if (!r) return null;
        const [a, b, v] = r, A = bikeByName(a), B = a === b ? null : bikeByName(b);
        return { kicker: "Bike Share · route", title: a === b ? `${a} (round trip)` : `${a} → ${b}`, body: [
          dStats([[fmt0(v), "trips (2023, 2024, 2026)"], [`#${+m_[1] + 1}`, `of the ${D().bike.routes.length} most-ridden routes`]]),
          a === b ? dNote("Round trips start and end at the same dock: leisure rides, often along the waterfront.") : null,
          dHead(a === b ? a : `Start · ${a}`), liveBlock(A), A ? dLink(href("bike", "live", A.id), "Show on the live map") : null,
          b !== a ? dHead(`End · ${b}`) : null, b !== a ? liveBlock(B) : null, B ? dLink(href("bike", "live", B.id), "Show on the live map") : null] };
      }
      const i = D().bike.stations.findIndex(([n]) => n === item); if (i < 0) return null;
      const [n, v] = D().bike.stations[i], b = bikeByName(n);
      return { kicker: "Bike Share · station", title: n, body: [
        dStats([[fmt0(v), "trips started since 2023"], [`#${i + 1}`, "busiest station"], [`${((100 * v) / D().bike.total_trips).toFixed(2)}%`, "of every trip"]]),
        liveBlock(b), b ? dLink(href("bike", "live", b.id), "Show on the live map") : null] };
    },
  },
};

// ------------------------------------------------------------------ live feed
function startLive() { if (!started) { started = true; loadBikes(); } }
async function loadBikes() {
  try {
    const [info, status] = await Promise.all([fetch(`${GBFS}/station_information`).then((r) => r.json()), fetch(`${GBFS}/station_status`).then((r) => r.json())]);
    const st = new Map(status.data.stations.map((s) => [s.station_id, s]));
    T.bikes = info.data.stations.map((s) => {
      const x = st.get(s.station_id) || {};
      // PBSC models: ICONIC is the classic bike; EFIT, ASTRO and BOOST are e-bikes
      const eb = (x.vehicle_types_available || []).filter((v) => v.vehicle_type_id !== "ICONIC").reduce((a, v) => a + (v.count || 0), 0)
        || (x.num_bikes_available_types || {}).ebike || 0;
      const cap = s.capacity || (x.num_bikes_available || 0) + (x.num_docks_available || 0) || 1;
      return { id: String(s.station_id), name: s.name, lon: s.lon, lat: s.lat, bikes: x.num_bikes_available || 0, ebikes: eb, docks: x.num_docks_available || 0, cap,
        frac: Math.min(1, (x.num_bikes_available || 0) / cap), on: x.is_renting === true || x.is_renting === 1 };
    });
    T.bikeTs = status.last_updated;
    pulse({ bikes: T.bikes, ts: status.last_updated });
    if (map) { if (map.isStyleLoaded()) addBikeLayer(); else map.once("idle", addBikeLayer); }
  } catch (e) {
    T.bikeFailed = true;
  }
  renderBikePanel();
  T.ctx.refresh();
}
const bikeById = (id) => T.bikes?.find((b) => b.id === String(id));
const norm = (s) => String(s).trim().toLowerCase().replace(/\s+/g, " ");
const bikeByName = (name) => T.bikes?.find((b) => norm(b.name) === norm(name));

function liveBlock(b) {
  if (!b) return dNote(T.bikes ? "This station isn't in the live feed right now." : T.bikeFailed ? "Live availability couldn't be loaded right now." : "Loading live availability…");
  return el("div", { class: "cx-dsec" }, el("h3", {}, b.on ? "Live right now" : "Live right now · not renting"),
    dStats([[fmtInt.format(b.bikes), "bikes"], [fmtInt.format(b.ebikes), "e-bikes"], [fmtInt.format(b.docks), "free docks"], [fmtInt.format(b.cap), "capacity"]], true),
    el("div", { class: "cx-fillbar", title: `${Math.round(b.frac * 100)}% of docks hold a bike` }, el("i", { style: { width: `${b.frac * 100}%`, background: b.frac < 0.25 ? "#d03b3b" : b.frac < 0.6 ? "#fab219" : "#1baf7a" } })));
}

// ------------------------------------------------------------------ live map
function ensureMap() {
  if (map) { map.resize(); highlightStation(); return; }
  map = new maplibregl.Map({ container: "map", style: T.isDark() ? MAP_STYLE.dark : MAP_STYLE.light, center: [-79.39, 43.66], zoom: 12,
    attributionControl: { compact: true }, cooperativeGestures: matchMedia("(pointer: coarse)").matches });
  if (import.meta.env.DEV) window.__map = map;
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  new ResizeObserver(() => map.resize()).observe($("map"));
  map.on("style.load", addBikeLayer);
  map.on("mousemove", "bikes", (e) => { map.getCanvas().style.cursor = "pointer"; const p = e.features[0].properties;
    tip.show(e.originalEvent.clientX, e.originalEvent.clientY, (t) => t.append(el("div", { class: "t-title" }, p.name),
      tipRow(null, `${p.bikes}`, `bikes (${p.ebikes} e-bikes)`), tipRow(null, `${p.docks}`, "free docks"))); });
  map.on("mouseleave", "bikes", () => { map.getCanvas().style.cursor = ""; tip.hide(); });
  map.on("click", "bikes", (e) => { tip.hide(); T.ctx.go("bike", "live", e.features[0].properties.id); });
  pulse({ map });
}
function addBikeLayer() {
  if (!T.bikes || !map.getStyle() || map.getSource("bikes")) return;
  map.addSource("bikes", { type: "geojson", data: { type: "FeatureCollection", features: T.bikes.map((b) => ({ type: "Feature", geometry: { type: "Point", coordinates: [b.lon, b.lat] }, properties: b })) } });
  map.addLayer({ id: "bikes", type: "circle", source: "bikes", paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 15, 8],
    "circle-color": ["case", ["!", ["get", "on"]], cssVar("--muted"), ["interpolate", ["linear"], ["get", "frac"], 0, "#d03b3b", 0.25, "#fab219", 0.6, "#1baf7a"]],
    "circle-stroke-color": cssVar("--surface"), "circle-stroke-width": 1 } });
  map.addLayer({ id: "bikes-sel", type: "circle", source: "bikes", filter: ["==", ["get", "id"], ""], paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 7, 15, 14], "circle-color": "rgba(0,0,0,0)",
    "circle-stroke-color": cssVar("--ink"), "circle-stroke-width": 2.5 } });
  highlightStation();
}
let flownTo = null;
function highlightStation() {
  if (!map || !map.getLayer("bikes-sel")) return;
  const r = route(), id = r.topic === "bike" && r.sub === "live" ? r.item : null;
  map.setFilter("bikes-sel", ["==", ["get", "id"], id || ""]);
  const b = id && bikeById(id);
  if (b && flownTo !== id) { flownTo = id; map.easeTo({ center: [b.lon, b.lat], zoom: Math.max(map.getZoom(), 14.5), duration: 700 }); }
  if (!id) flownTo = null;
}
function renderBikePanel() {
  const panel = $("bike-panel"), B = T.bikes;
  if (!B || !D()) { panel.replaceChildren(el("div", { class: "note" }, T.bikeFailed ? "Live bike availability couldn't be loaded right now." : "Loading live availability…")); return; }
  const tot = d3.sum(B, (b) => b.bikes), eb = d3.sum(B, (b) => b.ebikes), empty = B.filter((b) => b.on && b.bikes === 0).length;
  panel.replaceChildren(
    el("div", { class: "side-title note" }, `Live · ${new Date(T.bikeTs * 1000).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}`),
    el("div", {}, el("div", { class: "ramp" }), el("div", { class: "ramp-labels" }, el("span", {}, "Empty"), el("span", {}, "Some"), el("span", {}, "Plenty"))),
    el("div", { class: "stat-mini" }, el("b", {}, fmtInt.format(tot)), el("span", {}, `bikes docked right now, ${fmtInt.format(eb)} of them electric`)),
    el("div", { class: "stat-mini" }, el("b", {}, fmtInt.format(B.length)), el("span", {}, `stations · ${empty} empty at the moment`)),
    el("div", { class: "stat-mini" }, el("b", {}, d3.format(".2s")(D().bike.total_trips).replace("M", " million")), el("span", {}, `trips in the open ridership data since 2023 (through ${d3.timeFormat("%b %Y")(day(D().bike.data_through))})`)),
    el("p", { class: "note" }, "Every station's live availability, straight from Bike Share Toronto's open feed. Click a station for its detail."));
}

// ------------------------------------------------------------------ forecast & patterns
function renderBikeForecast() {
  const M = D().bike.metrics;
  $("bike-fc-sub").textContent = `Weather-driven daily trips. Tested on 2025–2026 it was ${Math.round((1 - M.mae / M.mae_base) * 100)}% more accurate than the same-weekday baseline (±${fmt0(M.mae)} vs ±${fmt0(M.mae_base)} trips a day, R² ${M.r2.toFixed(2)}).`;
  forecastCols("bike-fc", D().bike.forecast, "--bike", "trips expected", { wx: true });
}
function renderBikeMonthly() {
  const rows = D().bike.monthly.map(([d_, v]) => ({ d: day(d_), v }));
  const best = rows.reduce((a, b) => (b.v > a.v ? b : a));
  $("bike-monthly-sub").textContent = `Every trip in the open ridership files, ${d3.timeFormat("%b %Y")(rows[0].d)} to ${d3.timeFormat("%b %Y")(rows.at(-1).d)}. Busiest: ${d3.timeFormat("%B %Y")(best.d)} with ${fmt0(best.v)}.`;
  const m = { l: 44, r: 8, t: 8, b: 22 };
  const { g, iw, ih } = frame("bike-monthly", m, 200);
  const x = d3.scaleBand(rows.map((r) => +r.d), [0, iw]).padding(0.18);
  const y = d3.scaleLinear([0, best.v], [ih, 0]).nice();
  gridY(g, y, iw, ih, d3.format("~s"));
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`)
    .call(d3.axisBottom(x).tickValues(rows.filter((r) => r.d.getMonth() === 0).map((r) => +r.d)).tickFormat((v) => d3.timeFormat("%Y")(new Date(v))).tickSize(0).tickPadding(6)).call(axisClean);
  g.selectAll("path.b").data(rows).join("path").attr("class", "b").attr("d", (r) => colPath(x(+r.d), x.bandwidth(), y(r.v), ih, 2)).style("fill", "var(--bike)")
    .on("pointermove", (e, r) => tip.show(e.clientX, e.clientY, (t) => t.append(el("div", { class: "t-title" }, d3.timeFormat("%B %Y")(r.d)), tipRow(cssVar("--bike"), fmt0(r.v), "trips"))))
    .on("pointerleave", () => tip.hide());
}

// ------------------------------------------------------------------ overview tile: every station as a dot
function tileMap(host) {
  const m = { l: 4, r: 4, t: 4, b: 4 };
  const { svg, g, iw, ih } = frame(host, m, 170);
  const pts = T.bikes.filter((b) => b.lat > 43.5 && b.lat < 43.9 && b.lon > -79.7 && b.lon < -79.1);
  const proj = d3.geoMercator().fitExtent([[0, 0], [iw, ih - 16]], { type: "MultiPoint", coordinates: pts.map((b) => [b.lon, b.lat]) });
  const colr = d3.scaleLinear([0, 0.25, 0.6], ["#d03b3b", "#fab219", "#1baf7a"]).clamp(true);
  const r = Math.max(1.4, Math.min(2.6, Math.sqrt((iw * ih) / pts.length) / 6));
  g.selectAll("circle").data(pts).join("circle").attr("cx", (b) => proj([b.lon, b.lat])[0]).attr("cy", (b) => proj([b.lon, b.lat])[1]).attr("r", r)
    .style("fill", (b) => (b.on ? colr(b.frac) : cssVar("--muted"))).style("opacity", 0.9);
  svg.append("text").attr("class", "axis-t").attr("x", m.l + iw).attr("y", m.t + ih - 2).attr("text-anchor", "end").text("each dot a station · colour = share of docks with a bike");
}
