import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import * as d3 from "d3";
import { initTheme, initSkin, cssVar, tooltip, el, tipRow, loadJSON, fmtInt } from "../shared/ui.js";
import { pulse } from "./skin.js";

const GBFS = "https://tor.publicbikesystem.net/customer/gbfs/v2/en";
const MAP_STYLE = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" };
const LINE_VAR = { YU: "--line1", BD: "--line2", SHP: "--line4", SRT: "--line3" };
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const isDark = initTheme(document.getElementById("theme"));
initSkin(document.getElementById("skin"));
const tip = tooltip();
let D, map, sel = 0, bikes = null;
const fmt0 = d3.format(",.0f"), pct = (v) => `${Math.round(v * 100)}%`;
const day = (s) => new Date(String(s).slice(0, 10) + "T12:00");
const axisClean = (a) => a.select(".domain").remove();

init().catch((err) => {
  console.error(err);
  document.querySelector("main").prepend(el("div", { class: "wrap", style: { padding: "24px", color: "var(--accent)" } }, `Could not load data: ${err.message}`));
});

async function init() {
  D = await loadJSON("./data/toronto/toronto.json");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  sel = Math.max(0, D.ferry.forecast.findIndex((f) => day(f.date) >= today));
  renderDays();
  initMap();
  loadBikes();
  renderAll();
  pulse({ D, map }); // "Departure Board" skin: share already-loaded data
  window.addEventListener("skinchange", renderDays);
  document.getElementById("generated").textContent = `Data refreshed ${new Date(D.generated).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}`;
  let raf, lastW = 0;
  new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w === lastW) return; lastW = w; cancelAnimationFrame(raf); raf = requestAnimationFrame(renderAll); })
    .observe(document.querySelector("main"));
  window.addEventListener("themechange", () => { map?.setStyle(isDark() ? MAP_STYLE.dark : MAP_STYLE.light); renderAll(); });
}

function renderAll() {
  renderHourly(); renderToday(); renderFerryCard(); renderBacktest(); renderImportance("ferry-imp", D.ferry.importance, "--ferry");
  renderHistory(); renderHeat("ferry-heat", D.ferry.heat, "--ferry", (v) => `${fmt0(v)} riders/hr`);
  renderBikeForecast(); renderHeat("bike-heat", D.bike.hourly, "--bike", (v) => `${fmt0(v)} trips`);
  renderBars("bike-stations", D.bike.stations.map(([n, v]) => [n, v]), "--bike", (v) => fmt0(v));
  renderBars("bike-routes", D.bike.routes.map(([a, b, v]) => [a === b ? `${a} (round trip)` : `${a} → ${b}`, v]), "--bike", (v) => fmt0(v), 260);
  renderTtc();
}

function frame(id, height, m) {
  const host = document.getElementById(id);
  const width = Math.max(240, host.clientWidth);
  host.replaceChildren();
  const svg = d3.select(host).append("svg").attr("viewBox", `0 0 ${width} ${height}`);
  return { svg, g: svg.append("g").attr("transform", `translate(${m.l},${m.t})`), iw: width - m.l - m.r, ih: height - m.t - m.b, width };
}
const colPath = (x0, w, y0, base, r = 3) => { const h = base - y0, rr = Math.min(r, h, w / 2);
  return h <= 0 ? "" : `M${x0},${base}V${y0 + rr}Q${x0},${y0} ${x0 + rr},${y0}H${x0 + w - rr}Q${x0 + w},${y0} ${x0 + w},${y0 + rr}V${base}Z`; };
const barPath = (w, y0, h, r = 4) => { const rr = Math.min(r, w); return `M0,${y0}H${w - rr}Q${w},${y0} ${w},${y0 + rr}V${y0 + h - rr}Q${w},${y0 + h} ${w - rr},${y0 + h}H0Z`; };

// ------------------------------------------------------------------ ferry: the week
function crowdLevel(v) {
  const L = D.ferry.levels;
  if (v >= L.p97) return ["Packed", "#d03b3b"];
  if (v >= L.p90) return ["Very busy", "#ec835a"];
  if (v >= L.p75) return ["Busy", "#fab219"];
  if (v >= L.p50) return ["Moderate", "var(--ferry)"];
  return ["Quiet", "var(--muted)"];
}
function renderDays() {
  document.getElementById("days").replaceChildren(...D.ferry.forecast.map((f, i) => {
    const [lvl, col] = crowdLevel(f.pred);
    const d_ = day(f.date);
    return el("button", { type: "button", class: "day", "aria-pressed": i === sel, onclick: () => { sel = i; renderDays(); renderHourly(); } },
      el("div", { class: "dname" }, d3.timeFormat("%a %b %-d")(d_)),
      el("div", { class: "dsub" }, f.holiday || (f.day_off ? "Weekend" : "Weekday")),
      el("div", { class: "riders" }, fmt0(f.pred)),
      el("div", { class: "dsub" }, `riders · ${fmt0(f.lo)}–${fmt0(f.hi)}`),
      el("span", { class: "crowd", style: { boxShadow: `inset 3px 0 0 ${col}` } }, lvl),
      el("div", { class: "wx" }, `${Math.round(f.tmax)}° / ${Math.round(f.tmin)}°${f.precip >= 1 ? ` · ${f.precip.toFixed(0)} mm rain` : ""}`));
  }));
}
function renderHourly() {
  const f = D.ferry.forecast[sel];
  const rows = f.hourly.map(([h, v]) => ({ h, v }));
  const peak = rows.reduce((a, b) => (b.v > a.v ? b : a));
  document.getElementById("hourly-title").textContent = `When the crowds peak · ${d3.timeFormat("%A %b %-d")(day(f.date))}`;
  document.getElementById("hourly-sub").textContent = `Expected riders boarding each hour. Busiest around ${peak.h % 12 || 12} ${peak.h < 12 ? "am" : "pm"}, with about ${fmt0(peak.v)} riders that hour.`;
  hourBars("hourly", rows, "--ferry");
}
function hourBars(id, rows, color, overlay) {
  const m = { l: 40, r: 8, t: 8, b: 22 };
  const { g, iw, ih } = frame(id, 200, m);
  const x = d3.scaleBand(d3.range(6, 24), [0, iw]).padding(0.2);
  const y = d3.scaleLinear().domain([0, d3.max([...rows.map((r) => r.v), ...(overlay || []).map((r) => r.v)]) || 1]).nice().range([ih, 0]);
  g.append("g").attr("class", "grid").selectAll("line").data(y.ticks(4)).join("line").attr("x1", 0).attr("x2", iw).attr("y1", y).attr("y2", y);
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(6)).call(axisClean);
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).tickValues(d3.range(6, 24, 3)).tickFormat((h) => `${h % 12 || 12}${h < 12 ? "a" : "p"}`).tickSize(0).tickPadding(6)).call(axisClean);
  const bw = Math.min(24, x.bandwidth());
  g.selectAll("path.b").data(rows.filter((r) => r.h >= 6)).join("path").attr("class", "b").attr("d", (r) => colPath(x(r.h) + (x.bandwidth() - bw) / 2, bw, y(r.v), ih)).style("fill", `var(${color})`)
    .on("pointermove", (e, r) => tip.show(e.clientX, e.clientY, (t) => t.append(el("div", { class: "t-title" }, `${r.h % 12 || 12}:00 ${r.h < 12 ? "am" : "pm"}`), tipRow(cssVar(color), fmt0(r.v), "riders"))))
    .on("pointerleave", () => tip.hide());
  if (overlay) g.append("path").datum(overlay.filter((r) => r.h >= 6)).attr("d", d3.line().x((r) => x(r.h) + x.bandwidth() / 2).y((r) => y(r.v)).curve(d3.curveMonotoneX))
    .style("fill", "none").style("stroke", "var(--ink)").style("stroke-width", 2).style("stroke-dasharray", "4 3");
}
function renderToday() {
  const T = D.ferry.today;
  const rows = Object.entries(T.hourly).map(([h, v]) => ({ h: +h, v }));
  const fc = D.ferry.forecast.find((f) => f.date.slice(0, 10) === String(T.date).slice(0, 10));
  document.getElementById("today-sub").textContent = `${d3.timeFormat("%A %b %-d")(day(T.date))}: ${fmt0(T.redeemed)} riders as of ${new Date(T.last_slot).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}${fc ? `. The dashed line is the morning's forecast (${fmt0(fc.pred)} for the day).` : "."}`;
  hourBars("today", rows, "--ferry", fc ? fc.hourly.map(([h, v]) => ({ h, v })) : null);
}

// ------------------------------------------------------------------ ferry: model card & patterns
function renderFerryCard() {
  const M = D.ferry.metrics;
  document.getElementById("ferry-metrics").replaceChildren(...[
    ["Average daily error", `±${fmt0(M.mae)}`, `riders, vs ±${fmt0(M.mae_base)} for the baseline (${Math.round((1 - M.mae / M.mae_base) * 100)}% better)`],
    ["Error on busier days", pct(M.mape_busy), `typical miss on above-median days, vs ${pct(M.mape_busy_base)} baseline`],
    ["Variance explained", `${Math.round(M.r2 * 100)}%`, `R² across ${fmtInt.format(M.n_test)} test days`],
    ["80% range coverage", pct(M.coverage80), "share of test days inside the forecast's 80% range"],
  ].map(([l, v, s]) => el("div", { class: "card metric" }, el("div", { class: "label" }, l), el("div", { class: "value" }, v), el("div", { class: "sub" }, s))));
}
function renderBacktest() {
  const rows = D.ferry.backtest.map(([d_, o, p]) => ({ d: day(d_), o, p }));
  lineCompare("backtest", rows, "--ferry");
  document.getElementById("bt-legend").replaceChildren(
    el("span", { class: "key" }, el("i", { class: "band", style: { background: "var(--ferry)", opacity: 0.35 } }), "Actual riders"),
    el("span", { class: "key" }, el("i", { class: "line", style: { background: "var(--ink)" } }), "Forecast (made without seeing that day)"));
}
function lineCompare(id, rows, color) {
  const m = { l: 44, r: 10, t: 10, b: 22 };
  const { svg, g, iw, ih } = frame(id, 240, m);
  const x = d3.scaleTime(d3.extent(rows, (r) => r.d), [0, iw]);
  const y = d3.scaleLinear().domain([0, d3.max(rows, (r) => Math.max(r.o, r.p))]).nice().range([ih, 0]);
  g.append("g").attr("class", "grid").selectAll("line").data(y.ticks(4)).join("line").attr("x1", 0).attr("x2", iw).attr("y1", y).attr("y2", y);
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4).tickFormat(d3.format("~s")).tickSize(0).tickPadding(6)).call(axisClean);
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(6).tickSize(0).tickPadding(6)).call(axisClean);
  const bw = Math.max(1, iw / rows.length - 1);
  g.selectAll("rect").data(rows).join("rect").attr("x", (r) => x(r.d) - bw / 2).attr("width", bw).attr("y", (r) => y(r.o)).attr("height", (r) => ih - y(r.o)).style("fill", `var(${color})`).style("opacity", 0.35);
  g.append("path").datum(rows).attr("d", d3.line().x((r) => x(r.d)).y((r) => y(r.p))).style("fill", "none").style("stroke", "var(--ink)").style("stroke-width", 1.5);
  svg.on("pointermove", (e) => { const [px] = d3.pointer(e, g.node()); const r = rows[d3.bisector((q) => q.d).center(rows, x.invert(px))];
    tip.show(e.clientX, e.clientY, (t) => t.append(el("div", { class: "t-title" }, d3.timeFormat("%a %b %-d, %Y")(r.d)), tipRow(cssVar(color), fmt0(r.o), "actual"), tipRow(cssVar("--ink"), fmt0(r.p), "forecast"))); })
    .on("pointerleave", () => tip.hide());
}
function renderImportance(id, imp, color) {
  const rows = Object.entries(imp).map(([k, v]) => [k, Math.max(0, v)]).sort((a, b) => b[1] - a[1]);
  renderBars(id, rows, color, (v) => `+${fmt0(v)}`, 170);
}
function renderBars(id, rows, color, fmt, left = 200) {
  const rowH = 28, m = { l: left, r: 64, t: 4, b: 4 };
  const { g, iw } = frame(id, m.t + m.b + rowH * rows.length, m);
  const x = d3.scaleLinear([0, d3.max(rows, (r) => r[1]) || 1], [0, iw]);
  const r_ = g.selectAll("g").data(rows).join("g").attr("transform", (_, i) => `translate(0,${i * rowH})`);
  r_.append("text").attr("class", "label").attr("x", -10).attr("y", rowH / 2).attr("dy", "0.35em").attr("text-anchor", "end")
    .text((r) => (r[0].length > left / 6.5 ? r[0].slice(0, Math.floor(left / 6.5) - 1) + "…" : r[0])).append("title").text((r) => r[0]);
  r_.append("path").attr("d", (r) => barPath(Math.max(2, x(r[1])), (rowH - 14) / 2, 14)).style("fill", `var(${color})`);
  r_.append("text").attr("class", "label strong").attr("x", (r) => x(r[1]) + 6).attr("y", rowH / 2).attr("dy", "0.35em").style("font-size", "11px").text((r) => fmt(r[1]));
}
function renderHistory() {
  const rows = D.ferry.history.map(([d_, v]) => ({ d: day(d_), v }));
  const m = { l: 44, r: 10, t: 10, b: 22 };
  const { svg, g, iw, ih } = frame("ferry-history", 220, m);
  const x = d3.scaleTime(d3.extent(rows, (r) => r.d), [0, iw]);
  const y = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.v)]).nice().range([ih, 0]);
  g.append("g").attr("class", "grid").selectAll("line").data(y.ticks(4)).join("line").attr("x1", 0).attr("x2", iw).attr("y1", y).attr("y2", y);
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4).tickFormat(d3.format("~s")).tickSize(0).tickPadding(6)).call(axisClean);
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(8).tickSize(0).tickPadding(6)).call(axisClean);
  g.append("path").datum(rows).attr("d", d3.area().x((r) => x(r.d)).y0(ih).y1((r) => y(r.v)).curve(d3.curveMonotoneX)).style("fill", "var(--ferry)").style("opacity", 0.15);
  g.append("path").datum(rows).attr("d", d3.line().x((r) => x(r.d)).y((r) => y(r.v)).curve(d3.curveMonotoneX)).style("fill", "none").style("stroke", "var(--ferry)").style("stroke-width", 1.5);
  svg.on("pointermove", (e) => { const [px] = d3.pointer(e, g.node()); const r = rows[d3.bisector((q) => q.d).center(rows, x.invert(px))];
    tip.show(e.clientX, e.clientY, (t) => t.append(el("div", { class: "t-title" }, `Week of ${d3.timeFormat("%b %-d, %Y")(r.d)}`), tipRow(cssVar("--ferry"), fmt0(r.v), "riders"))); })
    .on("pointerleave", () => tip.hide());
}
function renderHeat(id, cells, color, fmt) {
  const data = cells.map(([d_, h, v]) => ({ d: d_, h, v })).filter((c) => c.h >= 5);
  const m = { l: 36, r: 8, t: 6, b: 22 };
  const { g, iw, ih } = frame(id, 210, m);
  const x = d3.scaleBand(d3.range(5, 24), [0, iw]).padding(0.06);
  const y = d3.scaleBand(d3.range(7), [0, ih]).padding(0.08);
  const c = d3.scaleSequential([0, d3.max(data, (r) => r.v)], d3.interpolateRgb(cssVar("--surface-2"), cssVar(color)));
  g.selectAll("rect").data(data).join("rect").attr("x", (r) => x(r.h)).attr("y", (r) => y(r.d)).attr("width", x.bandwidth()).attr("height", y.bandwidth()).attr("rx", 3)
    .style("fill", (r) => c(r.v))
    .on("pointermove", (e, r) => tip.show(e.clientX, e.clientY, (t) => t.append(el("div", { class: "t-title" }, `${DOW[r.d]} ${r.h % 12 || 12}${r.h < 12 ? " am" : " pm"}`), tipRow(cssVar(color), fmt(r.v), ""))))
    .on("pointerleave", () => tip.hide());
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).tickFormat((d_) => DOW[d_]).tickSize(0).tickPadding(6)).call(axisClean);
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).tickValues(d3.range(6, 24, 3)).tickFormat((h) => `${h % 12 || 12}${h < 12 ? "a" : "p"}`).tickSize(0).tickPadding(6)).call(axisClean);
}

// ------------------------------------------------------------------ bike share
function initMap() {
  map = new maplibregl.Map({ container: "map", style: isDark() ? MAP_STYLE.dark : MAP_STYLE.light, center: [-79.39, 43.66], zoom: 12,
    attributionControl: { compact: true }, cooperativeGestures: matchMedia("(pointer: coarse)").matches });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  new ResizeObserver(() => map.resize()).observe(document.getElementById("map"));
  map.on("style.load", addBikeLayer);
  map.on("mousemove", "bikes", (e) => { map.getCanvas().style.cursor = "pointer"; const p = e.features[0].properties;
    tip.show(e.originalEvent.clientX, e.originalEvent.clientY, (t) => t.append(el("div", { class: "t-title" }, p.name),
      tipRow(null, `${p.bikes}`, `bikes (${p.ebikes} e-bikes)`), tipRow(null, `${p.docks}`, "free docks"))); });
  map.on("mouseleave", "bikes", () => { map.getCanvas().style.cursor = ""; tip.hide(); });
}
async function loadBikes() {
  try {
    const [info, status] = await Promise.all([fetch(`${GBFS}/station_information`).then((r) => r.json()), fetch(`${GBFS}/station_status`).then((r) => r.json())]);
    const st = new Map(status.data.stations.map((s) => [s.station_id, s]));
    bikes = info.data.stations.map((s) => {
      const x = st.get(s.station_id) || {};
      // PBSC models: ICONIC is the classic bike; EFIT, ASTRO and BOOST are e-bikes
      const eb = (x.vehicle_types_available || []).filter((v) => v.vehicle_type_id !== "ICONIC").reduce((a, v) => a + (v.count || 0), 0)
        || (x.num_bikes_available_types || {}).ebike || 0;
      const cap = s.capacity || (x.num_bikes_available || 0) + (x.num_docks_available || 0) || 1;
      return { name: s.name, lon: s.lon, lat: s.lat, bikes: x.num_bikes_available || 0, ebikes: eb, docks: x.num_docks_available || 0, cap,
        frac: Math.min(1, (x.num_bikes_available || 0) / cap), on: x.is_renting === true || x.is_renting === 1 };
    });
    renderBikePanel(status.last_updated);
    pulse({ bikes, ts: status.last_updated });
    if (map.isStyleLoaded()) addBikeLayer(); else map.once("idle", addBikeLayer);
  } catch (e) {
    document.getElementById("bike-panel").replaceChildren(el("div", { class: "note" }, "Live bike availability couldn't be loaded right now."));
  }
}
function addBikeLayer() {
  if (!bikes || !map.getStyle() || map.getSource("bikes")) return;
  map.addSource("bikes", { type: "geojson", data: { type: "FeatureCollection", features: bikes.map((b) => ({ type: "Feature", geometry: { type: "Point", coordinates: [b.lon, b.lat] }, properties: b })) } });
  map.addLayer({ id: "bikes", type: "circle", source: "bikes", paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 15, 8],
    "circle-color": ["case", ["!", ["get", "on"]], cssVar("--muted"), ["interpolate", ["linear"], ["get", "frac"], 0, "#d03b3b", 0.25, "#fab219", 0.6, "#1baf7a"]],
    "circle-stroke-color": cssVar("--surface"), "circle-stroke-width": 1 } });
}
function renderBikePanel(ts) {
  const tot = d3.sum(bikes, (b) => b.bikes), eb = d3.sum(bikes, (b) => b.ebikes), empty = bikes.filter((b) => b.on && b.bikes === 0).length;
  document.getElementById("bike-panel").replaceChildren(
    el("div", { class: "side-title note" }, `Live · ${new Date(ts * 1000).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}`),
    el("div", {}, el("div", { class: "ramp" }), el("div", { class: "ramp-labels" }, el("span", {}, "Empty"), el("span", {}, "Some"), el("span", {}, "Plenty"))),
    el("div", { class: "stat-mini" }, el("b", {}, fmtInt.format(tot)), el("span", {}, `bikes docked right now, ${fmtInt.format(eb)} of them electric`)),
    el("div", { class: "stat-mini" }, el("b", {}, fmtInt.format(bikes.length)), el("span", {}, `stations · ${empty} empty at the moment`)),
    el("div", { class: "stat-mini" }, el("b", {}, d3.format(".2s")(D.bike.total_trips).replace("M", " million")), el("span", {}, `trips in the open ridership data since 2023 (through ${d3.timeFormat("%b %Y")(day(D.bike.data_through))})`)));
}
function renderBikeForecast() {
  const M = D.bike.metrics, F = D.bike.forecast;
  document.getElementById("bike-fc-sub").textContent = `Weather-driven daily trips. Tested on 2025–2026 it was ${Math.round((1 - M.mae / M.mae_base) * 100)}% more accurate than the same-weekday baseline (±${fmt0(M.mae)} vs ±${fmt0(M.mae_base)} trips a day, R² ${M.r2.toFixed(2)}).`;
  const m = { l: 44, r: 10, t: 14, b: 36 };
  const { g, iw, ih } = frame("bike-fc", 220, m);
  const x = d3.scaleBand(F.map((f) => f.date), [0, iw]).padding(0.3);
  const y = d3.scaleLinear().domain([0, d3.max(F, (f) => f.hi)]).nice().range([ih, 0]);
  g.append("g").attr("class", "grid").selectAll("line").data(y.ticks(4)).join("line").attr("x1", 0).attr("x2", iw).attr("y1", y).attr("y2", y);
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4).tickFormat(d3.format("~s")).tickSize(0).tickPadding(6)).call(axisClean);
  const bw = Math.min(24, x.bandwidth());
  const col = g.selectAll("g.c").data(F).join("g").attr("class", "c").attr("transform", (f) => `translate(${x(f.date) + (x.bandwidth() - bw) / 2},0)`);
  col.append("path").attr("d", (f) => colPath(0, bw, y(f.pred), ih)).style("fill", "var(--bike)");
  col.append("line").attr("x1", bw / 2).attr("x2", bw / 2).attr("y1", (f) => y(f.lo)).attr("y2", (f) => y(f.hi)).style("stroke", "var(--ink-2)");
  col.append("text").attr("class", "label").attr("x", bw / 2).attr("y", ih + 13).attr("text-anchor", "middle").style("font-size", "10.5px").text((f) => d3.timeFormat("%a")(day(f.date)));
  col.append("text").attr("class", "label").attr("x", bw / 2).attr("y", ih + 27).attr("text-anchor", "middle").style("font-size", "10px").style("fill", "var(--muted)")
    .text((f) => `${Math.round(f.tmax)}°${f.precip >= 1 ? "☂" : ""}`);
  col.append("rect").attr("x", -4).attr("width", bw + 8).attr("height", ih + 30).style("fill", "transparent")
    .on("pointermove", (e, f) => tip.show(e.clientX, e.clientY, (t) => t.append(el("div", { class: "t-title" }, d3.timeFormat("%A %b %-d")(day(f.date))),
      tipRow(cssVar("--bike"), fmt0(f.pred), "trips expected"), tipRow(null, `${fmt0(f.lo)}–${fmt0(f.hi)}`, "80% range"), tipRow(null, `${Math.round(f.tmax)}° · ${f.precip.toFixed(0)} mm`, "forecast"))))
    .on("pointerleave", () => tip.hide());
}

// ------------------------------------------------------------------ TTC
function renderTtc() {
  const T = D.ttc;
  document.getElementById("ttc-sub").textContent = `${fmtInt.format(T.n)} delays costing ${fmtInt.format(Math.round(T.minutes / 60))} hours of service, ${d3.timeFormat("%B %Y")(day(T.from))} to ${d3.timeFormat("%B %Y")(day(T.to))}, from the TTC's open delay log.`;
  const months = T.monthly.months.map(day);
  const lines = Object.keys(T.lines).filter((ln) => T.monthly[ln] && d3.sum(T.monthly[ln]) > 0);
  const m = { l: 44, r: 10, t: 10, b: 22 };
  const { svg, g, iw, ih } = frame("ttc-monthly", 240, m);
  const x = d3.scaleTime(d3.extent(months), [0, iw]);
  const y = d3.scaleLinear().domain([0, d3.max(lines.flatMap((ln) => T.monthly[ln]))]).nice().range([ih, 0]);
  g.append("g").attr("class", "grid").selectAll("line").data(y.ticks(4)).join("line").attr("x1", 0).attr("x2", iw).attr("y1", y).attr("y2", y);
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4).tickFormat(d3.format("~s")).tickSize(0).tickPadding(6)).call(axisClean);
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(6).tickSize(0).tickPadding(6)).call(axisClean);
  for (const ln of lines) g.append("path").datum(T.monthly[ln].map((v, i) => ({ d: months[i], v }))).attr("d", d3.line().x((r) => x(r.d)).y((r) => y(r.v)).curve(d3.curveMonotoneX))
    .style("fill", "none").style("stroke", `var(${LINE_VAR[ln]})`).style("stroke-width", 2);
  document.getElementById("ttc-legend").replaceChildren(...lines.map((ln) => el("span", { class: "key" }, el("i", { class: "line", style: { background: `var(${LINE_VAR[ln]})` } }), T.lines[ln])));
  svg.on("pointermove", (e) => { const [px] = d3.pointer(e, g.node()); const i = d3.bisector((d_) => d_).center(months, x.invert(px));
    tip.show(e.clientX, e.clientY, (t) => { t.append(el("div", { class: "t-title" }, d3.timeFormat("%B %Y")(months[i])));
      for (const ln of lines) t.append(tipRow(cssVar(LINE_VAR[ln]), `${fmt0(T.monthly[ln][i])} min`, T.lines[ln])); }); })
    .on("pointerleave", () => tip.hide());
  renderHeat("ttc-heat", T.heat, "--ttc", (v) => `${fmt0(v)} minutes per week`);
  renderBars("ttc-causes", T.causes.map(([code, desc, mins]) => [desc && desc !== code ? desc : code, mins]), "--ttc", (v) => `${fmtInt.format(Math.round(v / 60))} h`, 230);
  renderBars("ttc-stations", T.stations.map(([s, mins]) => [s, mins]), "--ttc", (v) => `${fmtInt.format(Math.round(v / 60))} h`, 200);
}
