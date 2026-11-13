// Toronto Island ferry: crowd forecast for the week, hour by hour, model accuracy and history.
import * as d3 from "d3";
import { cssVar, el, tipRow } from "../shared/ui.js";
import { frame, gridY, colPath, renderHeat, renderHourBars, renderCompare, hourLbl, hShort, axisClean } from "../shared/charts.js";
import { T, $, tip, fmt0, pct, day, fDay, fDayLong, loadData, crowdLevel, heatOpt, compareLegend, renderImportance, heatDrawer } from "./common.js";

const D = () => T.D;
const go = (...a) => T.ctx.go(...a);
let daysSig = "";
window.addEventListener("skinchange", () => { daysSig = ""; });

export const ferry = {
  id: "ferry", title: "Island ferry", color: "var(--ferry)",
  eyebrow: "Toronto Island ferry", heading: "Should you go to the Island this week?",
  load: loadData,
  badge: () => { const f = D().ferry.forecast[T.sel]; return [fmt0(f.pred), `ferry riders forecast, ${fDay(day(f.date))}`]; },
  kpis: () => {
    const f = D().ferry.forecast[T.sel], M = D().ferry.metrics, F = D().ferry.forecast;
    const hi = F.reduce((a, b) => (b.pred > a.pred ? b : a));
    const yr = Object.keys(D().ferry.yearly).sort().at(-1);
    return [
      [fDay(day(f.date)), fmt0(f.pred), `riders · ${crowdLevel(f.pred)[0]}`],
      ["Busiest this week", fDay(day(hi.date)).slice(0, 3) + " " + fmt0(hi.pred), hi.holiday || "riders"],
      ["Forecast error", `±${fmt0(M.mae)}`, `${Math.round((1 - M.mae / M.mae_base) * 100)}% better than baseline`],
      [`${yr} riders`, d3.format(".3s")(D().ferry.yearly[yr]), `to ${d3.timeFormat("%b %-d")(day(D().ferry.last_full))}`],
    ];
  },
  tile: (t) => {
    const f = D().ferry.forecast[T.sel];
    const [lvl, col] = crowdLevel(f.pred);
    const pk = f.hourly.reduce((a, b) => (b[1] > a[1] ? b : a));
    t.kpis([
      [fmt0(f.pred), `riders expected ${fDay(day(f.date))}`],
      [lvl, `crowd · range ${d3.format(".2s")(f.lo)}–${d3.format(".2s")(f.hi)}`, el("i", { class: "cx-tk-sw", style: { background: col } })],
      [hourLbl(pk[0]), `peak hour, ~${fmt0(pk[1])} riders`],
    ]);
    tileChart(t.vis);
  },
  subs: [
    { id: "week", title: "This week", class: "pane-week", view: () => { renderDays(); renderHourly(); renderToday(); }, html: `
      <div class="tc-week">
        <div class="days" id="days"></div>
        <p class="note cx-lede">The model forecasts every day's ferry crowd from the weather forecast, the calendar and recent ridership. It learned from eleven years of ticket counts, logged every 15 minutes. Pick a day to see its hours.</p>
      </div>
      <div class="cx-row cols-13-1">
        <div class="card cx-fill"><h3 class="cx-card-title" id="hourly-title">When the crowds peak</h3><p class="note cx-card-sub" id="hourly-sub"></p><div class="chart" id="hourly"></div></div>
        <div class="card cx-fill"><h3 class="cx-card-title">Today so far</h3><p class="note cx-card-sub" id="today-sub"></p><div class="chart" id="today"></div></div>
      </div>` },
    { id: "hourly", title: "Hour by hour", class: "pane-hourly",
      view: () => { renderMultiples(); renderHeat("ferry-heat", D().ferry.heat, "--ferry", (v) => `${fmt0(v)} riders/hr`, heatOpt("ferry", "hourly")); }, html: `
      <div class="card cx-fill"><h3 class="cx-card-title">Hourly profile of every forecast day</h3><p class="note cx-card-sub">Expected riders boarding each hour, on one shared scale. Click a day to open it in This week.</p><div class="multiples cx-grow" id="ferry-multiples"></div></div>
      <div class="card cx-fill"><h3 class="cx-card-title">A summer week, hour by hour</h3><p class="note cx-card-sub">Average riders boarding per hour, June–August since 2023. Click a cell for that hour across the week.</p><div class="chart" id="ferry-heat"></div></div>` },
    { id: "accuracy", title: "Forecast accuracy", short: "Accuracy", class: "pane-accuracy",
      view: () => {
        renderFerryCard();
        renderCompare("backtest", D().ferry.backtest.map(([d_, o, p]) => ({ d: day(d_), o, p })), "--ferry", "riders");
        compareLegend("bt-legend", "--ferry", "Actual riders");
        renderImportance("ferry-imp", D().ferry.importance, "--ferry");
      }, html: `
      <div>
        <p class="note cx-lede">Trained on 2015–2024 and tested on every day of 2025–2026 it never saw. The baseline is "the average for that weekday and month over the last three years".</p>
        <div class="tc-metrics" id="ferry-metrics"></div>
      </div>
      <div class="cx-row cols-13-1">
        <div class="card cx-fill"><h3 class="cx-card-title">Forecast vs actual, recent months</h3><div class="legend" id="bt-legend"></div><div class="chart" id="backtest"></div></div>
        <div class="card cx-fill"><h3 class="cx-card-title">What moves the crowd</h3><p class="note cx-card-sub">Extra error when each group of inputs is shuffled (riders per day).</p><div class="chart" id="ferry-imp"></div></div>
      </div>` },
    { id: "history", title: "History", class: "pane-history", view: () => { renderHistory(); renderYearly(); renderSeason(); renderRecords(); }, html: `
      <div class="card cx-fill"><h3 class="cx-card-title">Every week since 2019</h3><p class="note cx-card-sub">Ferry riders per week. The pandemic gap, then the recovery.</p><div class="chart" id="ferry-history"></div></div>
      <div class="cx-row cols-3">
        <div class="card cx-fill"><h3 class="cx-card-title">Riders per year</h3><p class="note cx-card-sub" id="ferry-yearly-sub">Tickets redeemed, 2015 onward.</p><div class="chart" id="ferry-yearly"></div></div>
        <div class="card cx-fill"><h3 class="cx-card-title">The season, week by week</h3><p class="note cx-card-sub">Typical riders per day in each week of the year.</p><div class="chart" id="ferry-season"></div></div>
        <div class="card cx-fill"><h3 class="cx-card-title">Ten busiest days on record</h3><ol class="records" id="ferry-records"></ol></div>
      </div>` },
  ],
  drawers: {
    hourly: (host, ctx, item) => heatDrawer(D().ferry.heat, "--ferry", "Ferry · a summer week", (v) => fmt0(v), "riders per hour")(host, ctx, item),
  },
};

// ------------------------------------------------------------------ the week
function renderDays() {
  const sig = `${T.sel}|${document.documentElement.dataset.skin || ""}`;
  if (sig === daysSig && $("days").children.length) return; // not size-dependent: keep the board's flaps still on resize
  daysSig = sig;
  $("days").replaceChildren(...D().ferry.forecast.map((f, i) => {
    const [lvl, col] = crowdLevel(f.pred);
    const d_ = day(f.date);
    return el("button", { type: "button", class: "day", "aria-pressed": i === T.sel, onclick: () => go("ferry", "week", f.date.slice(0, 10)) },
      el("div", { class: "dname" }, fDay(d_)),
      el("div", { class: "dsub" }, f.holiday || (f.day_off ? "Weekend" : "Weekday")),
      el("div", { class: "riders" }, fmt0(f.pred)),
      el("div", { class: "dsub" }, `riders · ${fmt0(f.lo)}–${fmt0(f.hi)}`),
      el("span", { class: "crowd", style: { boxShadow: `inset 3px 0 0 ${col}` } }, lvl),
      el("div", { class: "wx" }, `${Math.round(f.tmax)}° / ${Math.round(f.tmin)}°${f.precip >= 1 ? ` · ${f.precip.toFixed(0)} mm rain` : ""}`));
  }));
}
function renderHourly() {
  const f = D().ferry.forecast[T.sel];
  const rows = f.hourly.map(([h, v]) => ({ h, v }));
  const peak = rows.reduce((a, b) => (b.v > a.v ? b : a));
  $("hourly-title").textContent = `When the crowds peak · ${fDayLong(day(f.date))}`;
  $("hourly-sub").textContent = `Expected riders boarding each hour. Busiest around ${hourLbl(peak.h)}, with about ${fmt0(peak.v)} riders that hour.`;
  renderHourBars("hourly", rows, "--ferry");
}
function renderToday() {
  const t = D().ferry.today;
  const rows = Object.entries(t.hourly).map(([h, v]) => ({ h: +h, v }));
  const fc = D().ferry.forecast.find((f) => f.date.slice(0, 10) === String(t.date).slice(0, 10));
  $("today-sub").textContent = `${fDayLong(day(t.date))}: ${fmt0(t.redeemed)} riders as of ${new Date(t.last_slot).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}${fc ? `. The dashed line is the morning's forecast (${fmt0(fc.pred)} for the day).` : "."}`;
  renderHourBars("today", rows, "--ferry", fc ? fc.hourly.map(([h, v]) => ({ h, v })) : null);
}

// ------------------------------------------------------------------ hour by hour (small multiples of every forecast day)
function renderMultiples() {
  const F = D().ferry.forecast, max = d3.max(F, (f) => d3.max(f.hourly, (r) => r[1]));
  $("ferry-multiples").replaceChildren(...F.map((f, i) => {
    const [lvl, col] = crowdLevel(f.pred);
    return el("button", { type: "button", class: "mult", "aria-pressed": i === T.sel, "data-pick": "", onclick: () => go("ferry", "week", f.date.slice(0, 10)), "aria-label": `${fDayLong(day(f.date))}: ${fmt0(f.pred)} riders, ${lvl}` },
      el("div", { class: "mult-h" }, el("b", {}, fDay(day(f.date))), el("span", { style: { boxShadow: `inset 3px 0 0 ${col}` } }, lvl)),
      el("div", { class: "chart mult-c", id: `mult-${i}` }));
  }));
  F.forEach((f, i) => {
    const rows = f.hourly.map(([h, v]) => ({ h, v })).filter((r) => r.h >= 6);
    const m = { l: 4, r: 4, t: 14, b: 16 };
    const { g, iw, ih } = frame(`mult-${i}`, m, 120);
    const x = d3.scaleLinear([6, 23], [0, iw]), y = d3.scaleLinear([0, max], [ih, 0]);
    g.append("path").datum(rows).attr("d", d3.area().x((r) => x(r.h)).y0(ih).y1((r) => y(r.v)).curve(d3.curveMonotoneX)).style("fill", "var(--ferry)").style("opacity", 0.22);
    g.append("path").datum(rows).attr("d", d3.line().x((r) => x(r.h)).y((r) => y(r.v)).curve(d3.curveMonotoneX)).style("fill", "none").style("stroke", "var(--ferry)").style("stroke-width", 1.8);
    const pk = rows.reduce((a, b) => (b.v > a.v ? b : a));
    g.append("circle").attr("cx", x(pk.h)).attr("cy", y(pk.v)).attr("r", 3).style("fill", "var(--ferry)");
    g.append("text").attr("class", "label strong").attr("x", Math.min(iw - 2, Math.max(2, x(pk.h)))).attr("y", y(pk.v) - 5).attr("text-anchor", x(pk.h) > iw * 0.8 ? "end" : x(pk.h) < iw * 0.2 ? "start" : "middle").style("font-size", "10.5px").text(`${fmt0(pk.v)} · ${hShort(pk.h)}`);
    g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", ih).attr("y2", ih).style("stroke", "var(--axis)");
    for (const h of [9, 12, 15, 18, 21]) g.append("text").attr("class", "axis-t").attr("x", x(h)).attr("y", ih + 12).attr("text-anchor", "middle").text(hShort(h));
  });
}

// ------------------------------------------------------------------ accuracy & history
function renderFerryCard() {
  const M = D().ferry.metrics;
  $("ferry-metrics").replaceChildren(...[
    ["Average daily error", `±${fmt0(M.mae)}`, `riders, vs ±${fmt0(M.mae_base)} for the baseline (${Math.round((1 - M.mae / M.mae_base) * 100)}% better)`],
    ["Error on busier days", pct(M.mape_busy), `typical miss on above-median days, vs ${pct(M.mape_busy_base)} baseline`],
    ["Variance explained", `${Math.round(M.r2 * 100)}%`, `R² across ${new Intl.NumberFormat("en-CA").format(M.n_test)} test days`],
    ["80% range coverage", pct(M.coverage80), "share of test days inside the forecast's 80% range"],
  ].map(([l, v, s]) => el("div", { class: "card metric" }, el("div", { class: "label" }, l), el("div", { class: "value" }, v), el("div", { class: "sub" }, s))));
}
function renderHistory() {
  const rows = D().ferry.history.map(([d_, v]) => ({ d: day(d_), v }));
  const m = { l: 44, r: 10, t: 10, b: 22 };
  const { svg, g, iw, ih } = frame("ferry-history", m, 220);
  const x = d3.scaleTime(d3.extent(rows, (r) => r.d), [0, iw]);
  const y = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.v)]).nice().range([ih, 0]);
  gridY(g, y, iw, ih, d3.format("~s"));
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(8).tickSize(0).tickPadding(6)).call(axisClean);
  g.append("path").datum(rows).attr("d", d3.area().x((r) => x(r.d)).y0(ih).y1((r) => y(r.v)).curve(d3.curveMonotoneX)).style("fill", "var(--ferry)").style("opacity", 0.15);
  g.append("path").datum(rows).attr("d", d3.line().x((r) => x(r.d)).y((r) => y(r.v)).curve(d3.curveMonotoneX)).style("fill", "none").style("stroke", "var(--ferry)").style("stroke-width", 1.5);
  svg.on("pointermove", (e) => { const [px] = d3.pointer(e, g.node()); const r = rows[d3.bisector((q) => q.d).center(rows, x.invert(px))];
    tip.show(e.clientX, e.clientY, (t) => t.append(el("div", { class: "t-title" }, `Week of ${d3.timeFormat("%b %-d, %Y")(r.d)}`), tipRow(cssVar("--ferry"), fmt0(r.v), "riders"))); })
    .on("pointerleave", () => tip.hide());
}
const YEAR_NOTE = { 2015: "Counts start in mid-May", 2017: "Island flooding closed the parks for much of the summer", 2020: "Pandemic restrictions", 2021: "Pandemic restrictions" };
function renderYearly() {
  const rows = Object.entries(D().ferry.yearly).map(([y_, v]) => ({ y: y_, v }));
  const lastY = rows.at(-1).y;
  $("ferry-yearly-sub").textContent = `Tickets redeemed per year; ${lastY} runs to ${d3.timeFormat("%b %-d")(day(D().ferry.last_full))}.`;
  const m = { l: 36, r: 4, t: 8, b: 20 };
  const { g, iw, ih } = frame("ferry-yearly", m, 180);
  const x = d3.scaleBand(rows.map((r) => r.y), [0, iw]).padding(0.22);
  const y = d3.scaleLinear([0, d3.max(rows, (r) => r.v)], [ih, 0]).nice();
  gridY(g, y, iw, ih, d3.format("~s"));
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).tickValues(rows.map((r) => r.y).filter((_, i) => i % (iw < 260 ? 3 : 2) === 0)).tickFormat((v) => `’${v.slice(2)}`).tickSize(0).tickPadding(6)).call(axisClean);
  g.selectAll("path.b").data(rows).join("path").attr("class", "b").attr("d", (r) => colPath(x(r.y), x.bandwidth(), y(r.v), ih))
    .style("fill", "var(--ferry)").style("opacity", (r) => (YEAR_NOTE[r.y] && r.y !== "2015" ? 0.5 : 1))
    .on("pointermove", (e, r) => tip.show(e.clientX, e.clientY, (t) => { t.append(el("div", { class: "t-title" }, r.y), tipRow(cssVar("--ferry"), fmt0(r.v), "riders")); if (YEAR_NOTE[r.y]) t.append(el("div", { class: "t-title" }, YEAR_NOTE[r.y])); }))
    .on("pointerleave", () => tip.hide());
}
function renderSeason() {
  const rows = Object.entries(D().ferry.by_week).map(([w, v]) => ({ w: +w, v }));
  const m = { l: 36, r: 6, t: 10, b: 20 };
  const { svg, g, iw, ih } = frame("ferry-season", m, 180);
  const x = d3.scaleLinear([1, 52], [0, iw]), y = d3.scaleLinear([0, d3.max(rows, (r) => r.v)], [ih, 0]).nice();
  gridY(g, y, iw, ih, d3.format("~s"));
  for (const [lbl, w] of [["Jan", 1], ["Apr", 14], ["Jul", 27], ["Oct", 40]]) g.append("text").attr("class", "axis-t").attr("x", x(w)).attr("y", ih + 14).attr("text-anchor", "start").text(lbl);
  g.append("path").datum(rows).attr("d", d3.area().x((r) => x(r.w)).y0(ih).y1((r) => y(r.v)).curve(d3.curveMonotoneX)).style("fill", "var(--ferry)").style("opacity", 0.18);
  g.append("path").datum(rows).attr("d", d3.line().x((r) => x(r.w)).y((r) => y(r.v)).curve(d3.curveMonotoneX)).style("fill", "none").style("stroke", "var(--ferry)").style("stroke-width", 1.6);
  const wk = +d3.timeFormat("%V")(day(D().ferry.forecast[T.sel].date));
  const cur = rows.find((r) => r.w === wk);
  if (cur) {
    g.append("line").attr("x1", x(wk)).attr("x2", x(wk)).attr("y1", 0).attr("y2", ih).style("stroke", "var(--ink-2)").style("stroke-dasharray", "3 3");
    const right = x(wk) > iw * 0.6;
    g.append("text").attr("class", "label").attr("x", x(wk) + (right ? -4 : 4)).attr("y", 8).attr("text-anchor", right ? "end" : "start").style("font-size", "10.5px").text(`This week · ${fmt0(cur.v)}/day`);
  }
  svg.on("pointermove", (e) => { const [px] = d3.pointer(e, g.node()); const r = rows[Math.max(0, Math.min(51, Math.round(x.invert(px)) - 1))];
    tip.show(e.clientX, e.clientY, (t) => t.append(el("div", { class: "t-title" }, `Week ${r.w}`), tipRow(cssVar("--ferry"), fmt0(r.v), "riders on a typical day"))); })
    .on("pointerleave", () => tip.hide());
}
function renderRecords() {
  const R = D().ferry.records, max = R[0][1];
  $("ferry-records").replaceChildren(...R.map(([d_, v]) => el("li", {},
    el("span", { class: "rec-d" }, d3.timeFormat("%a %b %-d, %Y")(day(d_))),
    el("span", { class: "rec-bar" }, el("i", { style: { width: `${(100 * v) / max}%` } })),
    el("b", {}, fmt0(v)))));
}

// ------------------------------------------------------------------ overview tile: the week as crowd-coloured columns
function tileChart(host) {
  const F = D().ferry.forecast;
  const m = { l: 6, r: 6, t: 18, b: 34 };
  const { g, iw, ih } = frame(host, m, 160);
  const x = d3.scaleBand(F.map((f) => f.date), [0, iw]).padding(0.28);
  const y = d3.scaleLinear([0, d3.max(F, (f) => f.pred) * 1.05], [ih, 0]);
  g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", ih).attr("y2", ih).style("stroke", "var(--axis)");
  const bw = Math.min(54, x.bandwidth());
  const c = g.selectAll("g.c").data(F).join("g").attr("class", (f, i) => `c pick${i === T.sel ? " on" : ""}`).attr("data-pick", "")
    .attr("transform", (f) => `translate(${x(f.date) + (x.bandwidth() - bw) / 2},0)`)
    .attr("tabindex", 0).attr("role", "link").attr("aria-label", (f) => `${fDayLong(day(f.date))}: ${fmt0(f.pred)} riders, ${crowdLevel(f.pred)[0]}`)
    .on("click", (e, f) => { e.stopPropagation(); go("ferry", "week", f.date.slice(0, 10)); })
    .on("keydown", (e, f) => { if (e.key === "Enter") { e.stopPropagation(); go("ferry", "week", f.date.slice(0, 10)); } });
  c.append("rect").attr("x", -4).attr("y", -m.t).attr("width", bw + 8).attr("height", ih + m.t + m.b).style("fill", "transparent");
  c.append("path").attr("d", (f) => colPath(0, bw, y(f.pred), ih, 4)).style("fill", (f) => crowdLevel(f.pred)[1]).style("opacity", (f, i) => (i === T.sel ? 1 : 0.8));
  c.append("text").attr("class", "label strong").attr("x", bw / 2).attr("y", (f) => y(f.pred) - 5).attr("text-anchor", "middle").style("font-size", "11px").text((f) => d3.format(".2s")(f.pred));
  c.append("text").attr("class", "label").attr("x", bw / 2).attr("y", ih + 14).attr("text-anchor", "middle").style("font-size", "11px").style("font-weight", (f, i) => (i === T.sel ? 650 : null)).text((f) => d3.timeFormat("%a")(day(f.date)));
  c.append("text").attr("class", "axis-t").attr("x", bw / 2).attr("y", ih + 27).attr("text-anchor", "middle").text((f) => crowdLevel(f.pred)[0].replace("Very busy", "V. busy"));
}
