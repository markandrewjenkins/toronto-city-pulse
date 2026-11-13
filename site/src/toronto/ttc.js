// TTC subway delays: monthly trends by line, when delays happen, causes and stations.
import * as d3 from "d3";
import { cssVar, el, tipRow, fmtInt } from "../shared/ui.js";
import { frame, gridY, colPath, renderBars, renderHeat, DOW, hourLbl, axisClean } from "../shared/charts.js";
import { dStats, dChart, dNote, dLink, href } from "../shared/console.js";
import { T, $, tip, fmt0, pct, day, ordinal, loadData, barOpt, heatOpt, heatDrawer, route } from "./common.js";

const LINE_VAR = { YU: "--line1", BD: "--line2", SHP: "--line4", SRT: "--line3" };
const LINE_NO = { YU: "1", BD: "2", SHP: "4", SRT: "3" };
// short labels for the longest TTC incident descriptions (the drawer and tooltips keep the full text)
const CAUSE_SHORT = { MUIR: "Ill or injured rider, aid refused", MUI: "Ill or injured rider, transported", MUPAA: "Alarm pulled, no trouble found",
  MUPR1: "Priority One: train contacts person", MUPLB: "Fire or smoke, TTC source", TUO: "Transportation dept., other" };
const causeName = (code, desc) => (desc && desc !== code ? desc : code);
const causeShort = (code, desc) => CAUSE_SHORT[code] || causeName(code, desc);
const D = () => T.D;

export const ttc = {
  id: "ttc", title: "TTC subway", tileTitle: "TTC subway delays", color: "var(--ttc)",
  eyebrow: "TTC subway", heading: "When and why the subway stops",
  load: loadData,
  badge: () => { const tt = ttcTotals(); return [d3.format(".2s")(tt.latest), `subway delay minutes, ${tt.label}`]; },
  kpis: () => {
    const t = D().ttc, tt = ttcTotals();
    return [
      ["Delays logged", fmtInt.format(t.n), `${d3.timeFormat("%b %Y")(day(t.from))} – ${d3.timeFormat("%b %Y")(day(t.to))}`],
      ["Service lost", `${fmtInt.format(Math.round(t.minutes / 60))} h`, `${fmtInt.format(t.minutes)} minutes`],
      [tt.label, `${fmtInt.format(tt.latest)} min`, `${tt.delta >= 0 ? "+" : "−"}${Math.abs(Math.round(tt.delta * 100))}% vs a typical ${tt.monthName}`],
      ["Top cause", causeName(t.causes[0][0], t.causes[0][1]), `${fmtInt.format(Math.round(t.causes[0][2] / 60))} h lost`],
    ];
  },
  tile: (t) => {
    const tt = ttcTotals();
    t.kpis([
      [fmtInt.format(tt.latest), `delay minutes, ${tt.label}`],
      [`${tt.delta >= 0 ? "+" : "−"}${Math.abs(Math.round(tt.delta * 100))}%`, `vs a typical ${tt.monthName} (${fmtInt.format(Math.round(tt.typical))})`],
      [causeName(D().ttc.causes[0][0], D().ttc.causes[0][1]), "top cause since 2022"],
    ]);
    tileChart(t.vis, tt);
  },
  subs: [
    { id: "trends", title: "Delay trends", short: "Trends", class: "pane-trends", view: () => { renderTtcMonthly(); renderTtcLines(); }, html: `
      <div class="card cx-fill"><h3 class="cx-card-title">Minutes of delay per month</h3><p class="note cx-card-sub" id="ttc-sub">Every logged subway delay since 2022, from the TTC's open delay data.</p><div class="legend" id="ttc-legend"></div><div class="chart" id="ttc-monthly"></div></div>
      <div class="tc-lines" id="ttc-lines"></div>` },
    { id: "when", title: "When delays happen", short: "When", class: "pane-when",
      view: () => { renderHeat("ttc-heat", D().ttc.heat, "--ttc", (v) => `${fmt0(v)} minutes per week`, heatOpt("ttc", "when")); renderWorst(); }, html: `
      <div class="card cx-fill"><h3 class="cx-card-title">Delay minutes by hour of the week</h3><p class="note cx-card-sub">Average minutes lost per week in each hour, all lines. Click a cell to compare that hour across the week.</p><div class="chart" id="ttc-heat"></div></div>
      <div class="card cx-fill"><h3 class="cx-card-title">The worst hours</h3><p class="note cx-card-sub">Hours of the week that lose the most time.</p><ol class="ranked" id="ttc-worst"></ol></div>` },
    { id: "causes", title: "Causes", class: "pane-causes",
      view: () => {
        const t = D().ttc;
        renderBars("ttc-causes", t.causes.map(([code, desc, mins]) => [causeShort(code, desc), mins, code, causeName(code, desc)]), "--ttc", (v) => `${fmtInt.format(Math.round(v / 60))} h`, 230, barOpt("ttc", "causes"));
        const sev = t.causes.map(([code, desc, mins, n]) => [causeShort(code, desc), mins / n, code, causeName(code, desc)]).sort((a, b) => b[1] - a[1]);
        $("ttc-sev-sub").textContent = `How long each kind of incident holds trains, on average. All delays average ${(t.minutes / t.n).toFixed(1)} min.`;
        renderBars("ttc-cause-sev", sev, "--ttc", (v) => `${v.toFixed(1)} min`, 230, barOpt("ttc", "causes"));
      }, html: `
      <div class="card cx-fill"><h3 class="cx-card-title">Top causes</h3><p class="note cx-card-sub">Total minutes of delay by TTC incident code. Click a cause for its detail.</p><div class="chart" id="ttc-causes"></div></div>
      <div class="card cx-fill"><h3 class="cx-card-title">Minutes per incident</h3><p class="note cx-card-sub" id="ttc-sev-sub">How long each kind of incident holds trains, on average.</p><div class="chart" id="ttc-cause-sev"></div></div>` },
    { id: "stations", title: "Stations", class: "pane-tstations",
      view: () => {
        const t = D().ttc;
        renderBars("ttc-stations", t.stations.map(([s, mins]) => [s, mins, s]), "--ttc", (v) => `${fmtInt.format(Math.round(v / 60))} h`, 200, barOpt("ttc", "stations"));
        renderBars("ttc-station-n", t.stations.map(([s, , n]) => [s, n, s]), "--ttc", (v) => fmtInt.format(v), 200, barOpt("ttc", "stations"));
      }, html: `
      <div class="card cx-fill"><h3 class="cx-card-title">Stations losing the most time</h3><p class="note cx-card-sub">Total minutes of delay logged at each station. Click a station for its detail.</p><div class="chart" id="ttc-stations"></div></div>
      <div class="card cx-fill"><h3 class="cx-card-title">Incidents logged</h3><p class="note cx-card-sub">Number of delay incidents at the same stations.</p><div class="chart" id="ttc-station-n"></div></div>` },
  ],
  drawers: {
    when: (host, ctx, item) => heatDrawer(D().ttc.heat, "--ttc", "TTC · when delays happen", (v) => `${v.toFixed(1)}`, "minutes lost per week")(host, ctx, item),
    trends: (host, ctx, ln) => {
      const t = D().ttc; if (!t.lines[ln] || !t.monthly[ln]) return null;
      const s = t.monthly[ln], months = t.monthly.months.map(day), pk = d3.maxIndex(s), last = s.length - 1;
      const active = s.map((v, i) => [v, i]).filter(([v]) => v > 0);
      return { kicker: "TTC subway · line", title: t.lines[ln], body: [
        dStats([[`${fmtInt.format(Math.round(d3.sum(s) / 60))} h`, "delay since 2022"], [pct(t.share_10min_by_line[ln] || 0), "of its delays last 10+ min"],
          [`${fmtInt.format(s[pk])} min`, `worst month, ${d3.timeFormat("%b %Y")(months[pk])}`], [s[last] ? `${fmtInt.format(s[last])} min` : "—", s[last] ? d3.timeFormat("%b %Y")(months[last]) : `no service after ${d3.timeFormat("%b %Y")(months[active.at(-1)[1]])}`]]),
        dChart("dr-a", "Minutes of delay per month"),
        ln === "SRT" ? dNote("Line 3 Scarborough closed in July 2023 after a derailment and has been replaced by buses.") : null],
        after: () => {
          const { svg, g, iw, ih } = frame("dr-a", { l: 40, r: 8, t: 8, b: 22 }, 200);
          const x = d3.scaleTime(d3.extent(months), [0, iw]), y = d3.scaleLinear([0, d3.max(s)], [ih, 0]).nice();
          gridY(g, y, iw, ih, d3.format("~s"));
          g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(4).tickSize(0).tickPadding(6)).call(axisClean);
          g.append("path").datum(s).attr("d", d3.area().x((_, i) => x(months[i])).y0(ih).y1((v) => y(v)).curve(d3.curveMonotoneX)).style("fill", `var(${LINE_VAR[ln]})`).style("opacity", 0.2);
          g.append("path").datum(s).attr("d", d3.line().x((_, i) => x(months[i])).y((v) => y(v)).curve(d3.curveMonotoneX)).style("fill", "none").style("stroke", `var(${LINE_VAR[ln]})`).style("stroke-width", 1.8);
          svg.on("pointermove", (e) => { const [px] = d3.pointer(e, g.node()); const i = d3.bisector((d_) => d_).center(months, x.invert(px));
            tip.show(e.clientX, e.clientY, (tt) => tt.append(el("div", { class: "t-title" }, d3.timeFormat("%B %Y")(months[i])), tipRow(cssVar(LINE_VAR[ln]), `${fmt0(s[i])} min`, ""))); })
            .on("pointerleave", () => tip.hide());
        } };
    },
    causes: (host, ctx, code) => {
      const t = D().ttc, i = t.causes.findIndex(([c]) => c === code); if (i < 0) return null;
      const [, desc, mins, n] = t.causes[i], avg = t.minutes / t.n, per = mins / n;
      return { kicker: `TTC subway · delay cause · ${code}`, title: causeName(code, desc), body: [
        dStats([[`${fmtInt.format(Math.round(mins / 60))} h`, `lost since ${day(t.from).getFullYear()}`], [fmtInt.format(n), "incidents"], [`${per.toFixed(1)} min`, "per incident"], [pct(mins / t.minutes), "of all delay minutes"]]),
        dNote(`The ${ordinal(i + 1)} costliest cause. Each incident holds trains about ${per.toFixed(1)} minutes, ${per >= avg ? `${(per / avg).toFixed(1)}× the` : `${Math.round((1 - per / avg) * 100)}% under the`} average delay of ${avg.toFixed(1)} minutes.`),
        dChart("dr-a", "Minutes per incident"),
        dLink(href("ttc", "when"), "When delays happen")],
        after: () => renderBars("dr-a", [[causeShort(code, desc), per, "x", causeName(code, desc)], ["All delays", avg, "all"]], "--ttc", (v) => `${v.toFixed(1)} min`, 150, { selected: "x" }) };
    },
    stations: (host, ctx, name) => {
      const t = D().ttc, i = t.stations.findIndex(([s]) => s === name); if (i < 0) return null;
      const [, mins, n] = t.stations[i], avg = t.minutes / t.n, per = mins / n;
      return { kicker: "TTC subway · station", title: name, body: [
        dStats([[`${fmtInt.format(Math.round(mins / 60))} h`, "of delay logged here"], [fmtInt.format(n), "incidents"], [`${per.toFixed(1)} min`, "per incident"], [pct(mins / t.minutes), "of all delay minutes"]]),
        dNote(`The ${ordinal(i + 1)} station for total time lost. Terminal and interchange stations top this list: trains turn back or wait for connections there, so delays are often logged at them.`),
        dChart("dr-a", "Minutes per incident, vs the system"),
      ], after: () => renderBars("dr-a", [[name, per, "x"], ["All delays", avg, "all"]], "--ttc", (v) => `${v.toFixed(1)} min`, 150, { selected: "x" }) };
    },
  },
};

function ttcTotals() {
  const t = D().ttc, months = t.monthly.months.map(day);
  const tot = months.map((_, i) => Object.keys(t.lines).reduce((a, ln) => a + ((t.monthly[ln] || [])[i] || 0), 0));
  const i = tot.length - 1, mo = months[i].getMonth();
  const typical = d3.mean(tot.filter((_, j) => j < i && months[j].getMonth() === mo));
  return { months, tot, i, latest: tot[i], typical, delta: tot[i] / typical - 1, monthName: d3.timeFormat("%B")(months[i]), label: d3.timeFormat("%b %Y")(months[i]) };
}
const ttcLines = () => Object.keys(D().ttc.lines).filter((ln) => D().ttc.monthly[ln] && d3.sum(D().ttc.monthly[ln]) > 0);

function renderTtcMonthly() {
  const t = D().ttc;
  $("ttc-sub").textContent = `${fmtInt.format(t.n)} delays costing ${fmtInt.format(Math.round(t.minutes / 60))} hours of service, ${d3.timeFormat("%B %Y")(day(t.from))} to ${d3.timeFormat("%B %Y")(day(t.to))}, from the TTC's open delay log.`;
  const months = t.monthly.months.map(day);
  const lines = ttcLines();
  const m = { l: 44, r: 10, t: 10, b: 22 };
  const { svg, g, iw, ih } = frame("ttc-monthly", m, 240);
  const x = d3.scaleTime(d3.extent(months), [0, iw]);
  const y = d3.scaleLinear().domain([0, d3.max(lines.flatMap((ln) => t.monthly[ln]))]).nice().range([ih, 0]);
  gridY(g, y, iw, ih, d3.format("~s"));
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(6).tickSize(0).tickPadding(6)).call(axisClean);
  for (const ln of lines) g.append("path").datum(t.monthly[ln].map((v, i) => ({ d: months[i], v }))).attr("d", d3.line().x((r) => x(r.d)).y((r) => y(r.v)).curve(d3.curveMonotoneX))
    .style("fill", "none").style("stroke", `var(${LINE_VAR[ln]})`).style("stroke-width", 2);
  $("ttc-legend").replaceChildren(...lines.map((ln) => el("a", { class: "key", href: href("ttc", "trends", ln) }, el("i", { class: "line", style: { background: `var(${LINE_VAR[ln]})` } }), t.lines[ln])));
  const hover = g.append("line").attr("y1", 0).attr("y2", ih).style("stroke", "var(--axis)").style("opacity", 0);
  svg.on("pointermove", (e) => { const [px] = d3.pointer(e, g.node()); const i = d3.bisector((d_) => d_).center(months, x.invert(px));
    hover.attr("x1", x(months[i])).attr("x2", x(months[i])).style("opacity", 1);
    tip.show(e.clientX, e.clientY, (tt) => { tt.append(el("div", { class: "t-title" }, d3.timeFormat("%B %Y")(months[i])));
      for (const ln of lines) tt.append(tipRow(cssVar(LINE_VAR[ln]), `${fmt0(t.monthly[ln][i])} min`, t.lines[ln])); }); })
    .on("pointerleave", () => { tip.hide(); hover.style("opacity", 0); });
}
function renderTtcLines() {
  const t = D().ttc, r = route(), sel_ = r.topic === "ttc" && r.sub === "trends" ? r.item : null;
  const lines = ttcLines().sort((a, b) => d3.sum(t.monthly[b]) - d3.sum(t.monthly[a]));
  $("ttc-lines").replaceChildren(...lines.map((ln) => {
    const s = t.monthly[ln], last = s.length - 1;
    return el("a", { class: "line-card" + (sel_ === ln ? " on" : ""), href: href("ttc", "trends", ln), style: { "--lc": `var(${LINE_VAR[ln]})` } },
      el("span", { class: "line-bullet" }, LINE_NO[ln]),
      el("span", { class: "line-name" }, t.lines[ln].replace(/^Line \d /, "")),
      el("span", { class: "line-stat" }, el("b", {}, `${fmtInt.format(Math.round(d3.sum(s) / 60))} h`), " lost"),
      el("span", { class: "line-stat" }, s[last] ? el("b", {}, `${fmtInt.format(s[last])} min`) : el("b", {}, "closed"), s[last] ? ` in ${d3.timeFormat("%b")(day(t.monthly.months[last]))}` : ""),
      el("span", { class: "line-stat" }, el("b", {}, pct(t.share_10min_by_line[ln] || 0)), " of delays ≥ 10 min"),
      el("span", { class: "chart line-spark", id: `spark-${ln}` }));
  }));
  for (const ln of lines) {
    const s = t.monthly[ln];
    const { g, iw, ih } = frame(`spark-${ln}`, { l: 0, r: 0, t: 2, b: 2 }, 28);
    const x = d3.scaleLinear([0, s.length - 1], [0, iw]), y = d3.scaleLinear([0, d3.max(s) || 1], [ih, 0]);
    g.append("path").datum(s).attr("d", d3.area().x((_, i) => x(i)).y0(ih).y1((v) => y(v)).curve(d3.curveMonotoneX)).style("fill", `var(${LINE_VAR[ln]})`).style("opacity", 0.25);
    g.append("path").datum(s).attr("d", d3.line().x((_, i) => x(i)).y((v) => y(v)).curve(d3.curveMonotoneX)).style("fill", "none").style("stroke", `var(${LINE_VAR[ln]})`).style("stroke-width", 1.4);
  }
}
function renderWorst() {
  const t = D().ttc;
  const top = [...t.heat].sort((a, b) => b[2] - a[2]).slice(0, 10), max = top[0][2];
  const r = route(), selK = r.topic === "ttc" && r.sub === "when" ? r.item : null;
  $("ttc-worst").replaceChildren(...top.map(([d_, h, v]) => el("li", { class: selK === `${d_}-${h}` ? "on" : "" },
    el("a", { href: href("ttc", "when", `${d_}-${h}`) },
      el("span", { class: "rk-l" }, `${DOW[d_]} ${hourLbl(h)}`),
      el("span", { class: "rec-bar" }, el("i", { style: { width: `${(100 * v) / max}%`, background: "var(--ttc)" } })),
      el("b", {}, `${v.toFixed(0)} min`)))));
}

// ------------------------------------------------------------------ overview tile: monthly delay minutes vs a typical month
function tileChart(host, tt) {
  const m = { l: 34, r: 6, t: 8, b: 20 };
  const { g, iw, ih } = frame(host, m, 160);
  const x = d3.scaleBand(tt.months.map((d_) => +d_), [0, iw]).padding(0.18);
  const y = d3.scaleLinear([0, d3.max(tt.tot)], [ih, 0]).nice();
  gridY(g, y, iw, ih, d3.format("~s"));
  const mo = tt.months[tt.i].getMonth();
  g.selectAll("path").data(tt.tot).join("path").attr("d", (v, i) => colPath(x(+tt.months[i]), x.bandwidth(), y(v), ih, 1.5))
    .style("fill", (v, i) => (i === tt.i ? "var(--ttc)" : tt.months[i].getMonth() === mo ? "color-mix(in oklab, var(--ttc) 45%, var(--surface-2))" : "var(--grid)"));
  g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(tt.typical)).attr("y2", y(tt.typical)).style("stroke", "var(--ink-2)").style("stroke-dasharray", "3 3");
  g.append("text").attr("class", "axis-t halo").attr("x", 2).attr("y", y(tt.typical) - 4).text(`typical ${tt.monthName}`);
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`)
    .call(d3.axisBottom(x).tickValues(tt.months.filter((d_) => d_.getMonth() === 0).map((d_) => +d_)).tickFormat((v) => d3.timeFormat("%Y")(new Date(v))).tickSize(0).tickPadding(6)).call(axisClean);
}
