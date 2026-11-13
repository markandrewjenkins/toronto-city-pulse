// Weather: the 7-day forecast both demand models run on, and how much each model leans on it.
import * as d3 from "d3";
import { cssVar, el, tipRow } from "../shared/ui.js";
import { frame, axisClean } from "../shared/charts.js";
import { T, $, tip, fmt0, day, fDay, fDayLong, loadData, forecastCols, renderImportance } from "./common.js";

const D = () => T.D;
const go = (...a) => T.ctx.go(...a);

export const weather = {
  id: "weather", title: "Weather", color: "var(--wx)",
  eyebrow: "Weather", heading: "The forecast behind the forecasts",
  load: loadData,
  badge: () => { const f = D().ferry.forecast[T.sel]; return [`${Math.round(f.tmax)}°`, `high, ${fDay(day(f.date))}`]; },
  kpis: () => {
    const F = D().ferry.forecast, f = F[T.sel], warm = F.reduce((a, b) => (b.tmax > a.tmax ? b : a));
    const rainy = F.filter((x) => x.precip >= 1).length;
    return [
      [fDay(day(f.date)), `${Math.round(f.tmax)}° / ${Math.round(f.tmin)}°`, f.precip >= 1 ? `${f.precip.toFixed(0)} mm rain` : "dry"],
      ["Rain days", `${rainy} of 7`, `${fmt0(d3.sum(F, (x) => x.precip))} mm in total`],
      ["Warmest", `${fDay(day(warm.date)).slice(0, 3)} ${Math.round(warm.tmax)}°`, `coolest night ${Math.round(d3.min(F, (x) => x.tmin))}°`],
      ["Drives", "Both models", "the biggest single input"],
    ];
  },
  tile: (t) => {
    const F = D().ferry.forecast, f = F[T.sel], rainy = F.filter((x) => x.precip >= 1).length;
    t.kpis([
      [`${Math.round(f.tmax)}° / ${Math.round(f.tmin)}°`, `high / low ${fDay(day(f.date))}`],
      [f.precip >= 1 ? `${f.precip.toFixed(0)} mm` : "Dry", f.precip >= 1 ? "rain expected" : "no rain expected"],
      [`${rainy} of 7`, "days with rain this week"],
    ]);
    tempChart(t.vis, F, { l: 6, r: 6, t: 8, b: 32 });
  },
  subs: [
    { id: "week", title: "Week ahead", class: "pane-wxweek",
      view: () => {
        tempChart("wx-week", D().ferry.forecast, { l: 36, r: 10, t: 10, b: 24 }, { big: true, pick: (f) => go("ferry", "week", f.date.slice(0, 10)) });
        forecastCols("wx-ferry", D().ferry.forecast, "--ferry", "riders expected", { pick: (f) => go("ferry", "week", f.date.slice(0, 10)) });
        forecastCols("wx-bike", D().bike.forecast, "--bike", "trips expected", { pick: () => go("bike", "forecast") });
      }, html: `
      <div class="card cx-fill"><h3 class="cx-card-title">The next seven days</h3><p class="note cx-card-sub">Environment Canada's GEM forecast via Open-Meteo: daily high and low, and rain. Click a day to open its ferry crowd.</p><div class="chart" id="wx-week"></div></div>
      <div class="cx-row cols-2">
        <div class="card cx-fill"><h3 class="cx-card-title">Ferry riders it implies</h3><p class="note cx-card-sub">Forecast riders per day with the 80% range.</p><div class="chart" id="wx-ferry"></div></div>
        <div class="card cx-fill"><h3 class="cx-card-title">Bike Share trips it implies</h3><p class="note cx-card-sub">Forecast trips per day with the 80% range.</p><div class="chart" id="wx-bike"></div></div>
      </div>` },
    { id: "drivers", title: "What it drives", class: "pane-drivers",
      view: () => {
        const share = (imp) => Math.round((100 * imp.Weather) / d3.sum(Object.values(imp), (v) => Math.max(0, v)));
        $("wx-imp-ferry-sub").textContent = `Extra error in riders per day. Weather carries ${share(D().ferry.importance)}% of the signal.`;
        $("wx-imp-bike-sub").textContent = `Extra error in trips per day. Weather carries ${share(D().bike.importance)}% of the signal.`;
        renderImportance("wx-imp-ferry", D().ferry.importance, "--ferry");
        renderImportance("wx-imp-bike", D().bike.importance, "--bike");
      }, html: `
      <p class="note cx-lede">Both demand models see the same weather (high, low and rain) next to the calendar. Shuffle one group of inputs and see how much worse each model gets: weather is the biggest single driver of both.</p>
      <div class="cx-row cols-2">
        <div class="card cx-fill"><h3 class="cx-card-title">Ferry model</h3><p class="note cx-card-sub" id="wx-imp-ferry-sub">Extra error in riders per day.</p><div class="chart" id="wx-imp-ferry"></div></div>
        <div class="card cx-fill"><h3 class="cx-card-title">Bike Share model</h3><p class="note cx-card-sub" id="wx-imp-bike-sub">Extra error in trips per day.</p><div class="chart" id="wx-imp-bike"></div></div>
      </div>` },
  ],
};

// shared weather picture: a high/low band with a capsule per day, and rain columns rising from the baseline
function tempChart(id, F, m, opt = {}) {
  const { g, iw, ih } = frame(id, m, 200);
  const sel = T.sel;
  const rainH = Math.min(opt.big ? 64 : 34, ih * 0.26), tH = ih - rainH - (opt.big ? 20 : 12);
  const x = d3.scaleBand(F.map((f) => f.date), [0, iw]).padding(0.3);
  const lo = d3.min(F, (f) => f.tmin), hi = d3.max(F, (f) => f.tmax);
  const y = d3.scaleLinear([lo - 3, hi + 1], [tH, 16]);
  const yr = d3.scaleLinear([0, Math.max(10, d3.max(F, (f) => f.precip))], [0, rainH]);
  const cx = (f) => x(f.date) + x.bandwidth() / 2;
  if (opt.big) {
    g.append("g").attr("class", "grid").selectAll("line").data(y.ticks(4)).join("line").attr("x1", 0).attr("x2", iw).attr("y1", y).attr("y2", y);
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4).tickFormat((v) => `${v}°`).tickSize(0).tickPadding(6)).call(axisClean);
    g.append("text").attr("class", "axis-t").attr("x", -6).attr("y", ih - 2).attr("text-anchor", "end").text("rain");
  }
  g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", ih).attr("y2", ih).style("stroke", "var(--axis)");
  g.append("path").datum(F).attr("d", d3.area().x(cx).y0((f) => y(f.tmin)).y1((f) => y(f.tmax)).curve(d3.curveMonotoneX)).style("fill", "var(--wx)").style("opacity", 0.12);
  g.append("path").datum(F).attr("d", d3.line().x(cx).y((f) => y(f.tmax)).curve(d3.curveMonotoneX)).style("fill", "none").style("stroke", "var(--wx)").style("stroke-width", 1.6);
  g.append("path").datum(F).attr("d", d3.line().x(cx).y((f) => y(f.tmin)).curve(d3.curveMonotoneX)).style("fill", "none").style("stroke", "var(--wx)").style("stroke-width", 1.2).style("stroke-dasharray", "3 3").style("opacity", 0.7);
  const cw = opt.big ? 12 : 9, rw = Math.min(opt.big ? 34 : 22, x.bandwidth() * 0.6);
  const col = g.selectAll("g.c").data(F).join("g").attr("class", (f, i) => `c${i === sel ? " on" : ""}`).attr("transform", (f) => `translate(${cx(f)},0)`);
  col.append("rect").attr("x", -cw / 2).attr("width", cw).attr("y", (f) => y(f.tmax)).attr("height", (f) => Math.max(cw, y(f.tmin) - y(f.tmax))).attr("rx", cw / 2)
    .style("fill", "var(--wx)").style("opacity", (f, i) => (i === sel ? 1 : 0.8));
  col.append("text").attr("class", "label strong").attr("y", (f) => y(f.tmax) - 6).attr("text-anchor", "middle").style("font-size", opt.big ? "13px" : "11px").text((f) => `${Math.round(f.tmax)}°`);
  col.append("text").attr("class", "label").attr("y", (f) => y(f.tmin) + (opt.big ? 15 : 13)).attr("text-anchor", "middle").style("font-size", opt.big ? "11.5px" : "10.5px").style("fill", "var(--muted)").text((f) => `${Math.round(f.tmin)}°`);
  col.append("rect").attr("x", -rw / 2).attr("width", rw).attr("y", (f) => ih - yr(f.precip)).attr("height", (f) => yr(f.precip)).attr("rx", 2).style("fill", "var(--rain)");
  if (opt.big) col.append("text").attr("class", "label").attr("y", (f) => ih - yr(f.precip) - 4).attr("text-anchor", "middle").style("font-size", "10.5px").style("fill", "var(--muted)").text((f) => (f.precip >= 0.5 ? `${f.precip.toFixed(0)} mm` : ""));
  col.append("text").attr("class", "label").attr("y", ih + 14).attr("text-anchor", "middle").style("font-size", "11px").style("font-weight", (f, i) => (i === sel ? 650 : null))
    .text((f) => (opt.big ? fDay(day(f.date)) : d3.timeFormat("%a")(day(f.date))));
  if (!opt.big) col.append("text").attr("class", "axis-t").attr("y", ih + 27).attr("text-anchor", "middle").text((f) => (f.precip >= 1 ? `${f.precip.toFixed(0)} mm` : "dry"));
  if (opt.pick) {
    col.append("rect").attr("x", -x.bandwidth() / 2 - 4).attr("width", x.bandwidth() + 8).attr("y", -m.t).attr("height", ih + m.t + m.b).style("fill", "transparent").style("cursor", "pointer")
      .on("click", (e, f) => { tip.hide(); opt.pick(f); })
      .on("pointermove", (e, f) => tip.show(e.clientX, e.clientY, (t) => t.append(el("div", { class: "t-title" }, fDayLong(day(f.date)) + (f.holiday ? ` · ${f.holiday}` : "")),
        tipRow(cssVar("--wx"), `${Math.round(f.tmax)}° / ${Math.round(f.tmin)}°`, "high / low"), tipRow(cssVar("--rain"), `${f.precip.toFixed(1)} mm`, "rain"),
        tipRow(cssVar("--ferry"), fmt0(f.pred), "ferry riders expected"))))
      .on("pointerleave", () => tip.hide());
  }
}
