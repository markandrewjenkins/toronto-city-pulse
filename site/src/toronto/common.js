// Toronto City Pulse: state and helpers shared by the topic modules (ferry, bike, ttc, weather).
// All four topics read one data file, loaded once by loadData() whichever module asks first.
import * as d3 from "d3";
import { cssVar, tooltip, el, tipRow, loadJSON } from "../shared/ui.js";
import { frame, gridY, colPath, renderBars, renderHourBars, DOW_LONG, hourLbl } from "../shared/charts.js";
import { dStats, dChart } from "../shared/console.js";
import { pulse } from "./skin.js";

// D: toronto.json · sel: index of the selected ferry forecast day (drives the overview, weather and badges)
// bikes / bikeTs / bikeFailed: the live Bike Share feed · ctx: the console context · isDark: theme probe
export const T = { D: null, sel: 0, bikes: null, bikeTs: null, bikeFailed: false, ctx: null, isDark: () => false };

export const tip = tooltip();
export const $ = (id) => (typeof id === "string" ? document.getElementById(id) : id);
export const fmt0 = d3.format(",.0f"), pct = (v) => `${Math.round(v * 100)}%`;
export const day = (s) => new Date(String(s).slice(0, 10) + "T12:00");
export const fDay = d3.timeFormat("%a %b %-d"), fDayLong = d3.timeFormat("%A %b %-d");
export const ordinal = (n) => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
export const route = () => T.ctx.route;

let loading = null;
export function loadData(ctx) {
  return (loading ||= loadJSON("./data/toronto/toronto.json").then((D) => {
    T.D = D;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    T.sel = Math.max(0, D.ferry.forecast.findIndex((f) => day(f.date) >= today));
    syncSel(ctx.route);
    const gen = `Data refreshed ${new Date(D.generated).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}`;
    for (const id of ["generated", "generated-rail"]) { const n = $(id); if (n) n.textContent = gen; }
    pulse({ D }); // "Departure Board" skin: share already-loaded data
  }));
}
// a ferry day in the route (#ferry/week/2026-10-17) becomes the selected day everywhere
export function syncSel(r) {
  if (!T.D || !r || r.topic !== "ferry" || r.sub !== "week" || !r.item) return;
  const i = T.D.ferry.forecast.findIndex((f) => f.date.slice(0, 10) === r.item);
  if (i >= 0) T.sel = i;
}

export function crowdLevel(v) {
  const L = T.D.ferry.levels;
  if (v >= L.p97) return ["Packed", "#d03b3b"];
  if (v >= L.p90) return ["Very busy", "#ec835a"];
  if (v >= L.p75) return ["Busy", "#fab219"];
  if (v >= L.p50) return ["Moderate", "var(--ferry)"];
  return ["Quiet", "var(--muted)"];
}

// chart options that make bars / heat cells open the drawer for this topic/sub, and highlight the open item
export const barOpt = (t, s) => ({ selected: route().topic === t && route().sub === s ? route().item : null, pick: (k) => T.ctx.go(t, s, k) });
export const heatOpt = (t, s) => ({ selected: route().topic === t && route().sub === s ? route().item : null, pick: (d_, h) => T.ctx.go(t, s, `${d_}-${h}`) });

export function compareLegend(id, color, actual) {
  $(id).replaceChildren(
    el("span", { class: "key" }, el("i", { class: "band", style: { background: `var(${color})`, opacity: 0.35 } }), actual),
    el("span", { class: "key" }, el("i", { class: "line", style: { background: "var(--ink)" } }), "Forecast (made without seeing that day)"));
}
export function renderImportance(id, imp, color) {
  const rows = Object.entries(imp).map(([k, v]) => [k, Math.max(0, v)]).sort((a, b) => b[1] - a[1]);
  renderBars(id, rows, color, (v) => `+${fmt0(v)}`, 170);
}

// columns with 80% whiskers for a 7-day forecast (bike trips, ferry riders)
export function forecastCols(id, F, color, unit, opt = {}) {
  const m = { l: 44, r: 10, t: 14, b: opt.wx ? 36 : 22 };
  const { g, iw, ih } = frame(id, m, 220);
  const x = d3.scaleBand(F.map((f) => f.date), [0, iw]).padding(0.3);
  const y = d3.scaleLinear().domain([0, d3.max(F, (f) => f.hi)]).nice().range([ih, 0]);
  gridY(g, y, iw, ih, d3.format("~s"));
  const bw = Math.min(30, x.bandwidth());
  const col = g.selectAll("g.c").data(F).join("g").attr("class", "c").attr("transform", (f) => `translate(${x(f.date) + (x.bandwidth() - bw) / 2},0)`);
  col.append("path").attr("d", (f) => colPath(0, bw, y(f.pred), ih)).style("fill", `var(${color})`);
  col.append("line").attr("x1", bw / 2).attr("x2", bw / 2).attr("y1", (f) => y(f.lo)).attr("y2", (f) => y(f.hi)).style("stroke", "var(--ink-2)");
  col.append("text").attr("class", "label").attr("x", bw / 2).attr("y", ih + 13).attr("text-anchor", "middle").style("font-size", "10.5px").text((f) => d3.timeFormat("%a")(day(f.date)));
  if (opt.wx) col.append("text").attr("class", "label").attr("x", bw / 2).attr("y", ih + 27).attr("text-anchor", "middle").style("font-size", "10px").style("fill", "var(--muted)")
    .text((f) => `${Math.round(f.tmax)}°${f.precip >= 1 ? "☂" : ""}`);
  col.append("rect").attr("x", -4).attr("width", bw + 8).attr("height", ih + (opt.wx ? 30 : 16)).style("fill", "transparent").style("cursor", opt.pick ? "pointer" : null)
    .on("click", (e, f) => { if (opt.pick) { tip.hide(); opt.pick(f); } })
    .on("pointermove", (e, f) => tip.show(e.clientX, e.clientY, (t) => t.append(el("div", { class: "t-title" }, fDayLong(day(f.date))),
      tipRow(cssVar(color), fmt0(f.pred), unit), tipRow(null, `${fmt0(f.lo)}–${fmt0(f.hi)}`, "80% range"), tipRow(null, `${Math.round(f.tmax)}° · ${f.precip.toFixed(0)} mm`, "forecast"))))
    .on("pointerleave", () => tip.hide());
}

// drawer for one cell of a weekday × hour heatmap: that hour on every day, and that whole day
export function heatDrawer(cells, color, label, fmt, unit) {
  return (host, ctx, item) => {
    const [d_, h] = item.split("-").map(Number);
    const at = new Map(cells.map(([a, b, v]) => [`${a}-${b}`, v]));
    if (!at.has(item)) return null;
    const v = at.get(item), sorted = [...cells].sort((a, b) => b[2] - a[2]), rank = sorted.findIndex(([a, b]) => a === d_ && b === h) + 1;
    return {
      kicker: label, title: `${DOW_LONG[d_]}, ${hourLbl(h)}`,
      body: [
        dStats([[fmt(v), unit], [`#${rank}`, `of ${cells.length} hours in the week`]]),
        dChart("dr-a", `${hourLbl(h)} on every day`),
        dChart("dr-b", `All of ${DOW_LONG[d_]}`),
      ],
      after: () => {
        renderBars("dr-a", d3.range(7).map((k) => [DOW_LONG[k], at.get(`${k}-${h}`) || 0, k]), color, fmt, 90, { selected: d_ });
        renderHourBars("dr-b", d3.range(6, 24).map((hh) => ({ h: hh, v: at.get(`${d_}-${hh}`) || 0 })), color, null, { compact: true, hl: h, unit });
      },
    };
  };
}
