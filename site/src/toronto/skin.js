// "Departure Board" skin extras for Toronto City Pulse: a station PA live strip, a Solari split-flap ferry board
// with a service-notice ticker, a TTC-trim basemap tint and a footer flavour line.
// Everything here exists only while the skin is active (data-skin="alt" on <html>) and is removed when it is switched off.
// It only reads data main.js already loaded, handed over through pulse().

const root = document.documentElement;
const on = () => root.dataset.skin === "alt";
const dark = () => (root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const nf = new Intl.NumberFormat("en-CA");
const n0 = (v) => nf.format(Math.round(v));
const S = {}; // { D, map, bikes, ts }
let built = null, played = false, observer = null, clock = 0;

export function pulse(patch) {
  Object.assign(S, patch);
  if (patch.map) hookMap(patch.map);
  if (on()) { build(); update(); }
}

function h(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// ------------------------------------------------------------------ build / teardown
function build() {
  if (built) return;
  const days = document.getElementById("days");
  if (!days) return;
  const top = document.querySelector(".topbar");

  // live strip: the station PA readout
  const strip = h("div", "db-strip");
  strip.setAttribute("aria-hidden", "true");
  strip.innerHTML = `<div class="db-strip-in">
    <span class="db-live"><i class="db-dot"></i>LIVE</span>
    <span class="db-r"><em>Bikes docked</em><b data-k="bikes">—</b></span>
    <span class="db-r"><em>E-bikes</em><b data-k="ebikes">—</b></span>
    <span class="db-r"><em>Empty stations</em><b data-k="empty">—</b></span>
    <span class="db-r"><em>Ferry today</em><b data-k="ferry">—</b><s data-k="ferryLvl"></s></span>
    <span class="db-r"><em data-k="ttcLbl">TTC delay</em><b data-k="ttc">—</b></span>
    <span class="db-r db-asof"><em>Data as of</em><b data-k="asof">—</b></span>
  </div>`;
  top.after(strip);

  // the board: head + column header + the existing #days rows + a scrolling service notice
  const board = h("div", "db-board");
  const head = h("div", "db-head");
  head.setAttribute("aria-hidden", "true");
  head.innerHTML = `<div class="db-head-l"><span class="db-bullet">1</span><span><b>Jack Layton Ferry Terminal</b><small>Island crowd forecast · next 7 days</small></span></div>
    <div class="db-clock" data-k="clock">--:--</div>`;
  const cols = h("div", "db-cols");
  cols.setAttribute("aria-hidden", "true");
  for (const [c, t] of [["name", "Day"], ["type", "Service"], ["riders", "Forecast riders"], ["range", "80% range"], ["crowd", "Crowd"], ["wx", "Weather"]])
    cols.append(h("span", `db-c-${c}`, t));
  const tick = h("div", "db-ticker");
  tick.setAttribute("aria-hidden", "true");
  tick.innerHTML = `<span class="db-tag">Service notice</span><div class="db-tick-win"><div class="db-tick-run"></div></div>`;
  days.before(board);
  board.append(head, cols, days, tick);

  // footer flavour
  const foot = document.querySelector("footer.site .wrap");
  const flav = h("p", "db-flavour", "Please stand clear of the doors. Mind the gap between the dock and the ferry.");
  flav.setAttribute("aria-hidden", "true");
  foot?.append(flav);

  observer = new MutationObserver(() => decorate());
  observer.observe(days, { childList: true });
  decorate();
  const tickClock = () => { const c = board.querySelector('[data-k="clock"]'); if (c) c.textContent = hhmm(new Date()); };
  tickClock(); clock = setInterval(tickClock, 15000);
  built = { strip, board, days, flav };
}

function teardown() {
  if (!built) return;
  observer?.disconnect(); observer = null;
  clearInterval(clock);
  const { strip, board, days, flav } = built;
  board.before(days);
  board.remove(); strip.remove(); flav.remove();
  built = null;
}

window.addEventListener("skinchange", () => { if (on()) { build(); update(); } else teardown(); });

// ------------------------------------------------------------------ split-flap rows
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function flaps(text, cls) {
  const wrap = h("span", `db-flaps ${cls || ""}`);
  for (const ch of String(text).toUpperCase()) {
    if (ch === "," || ch === ".") { wrap.append(h("span", "fl-p", ch)); continue; }
    const t = h("span", "fl", ch === " " ? " " : ch);
    t.dataset.ch = ch === " " ? " " : ch;
    wrap.append(t);
  }
  return wrap;
}

function decorate() {
  const days = document.getElementById("days");
  if (!on() || !days) return;
  const rows = [...days.querySelectorAll("button.day")];
  rows.forEach((b) => {
    if (b.dataset.db) return;
    b.dataset.db = "1";
    const [name, riders, crowd, wx] = [".dname", ".riders", ".crowd", ".wx"].map((s) => b.querySelector(s));
    const [typeEl, rangeEl] = b.querySelectorAll(".dsub");
    const dayTxt = name.textContent, ridersTxt = riders.textContent, lvl = crowd.textContent;
    rangeEl.textContent = rangeEl.textContent.replace(/^riders\s*·\s*/, "");
    typeEl.classList.add("db-type"); rangeEl.classList.add("db-range");
    name.replaceChildren(flaps(dayTxt));
    riders.replaceChildren(flaps(ridersTxt));
    crowd.dataset.level = lvl.toLowerCase().replace(/\s+/g, "-");
    crowd.style.boxShadow = "";
    crowd.replaceChildren(flaps(lvl));
    const meta = h("span", "db-meta");
    meta.append(typeEl, rangeEl, wx);
    b.append(meta);
    b.setAttribute("aria-label", `${dayTxt}, ${typeEl.textContent}: about ${ridersTxt} riders (80% range ${rangeEl.textContent}), ${lvl}. Weather ${wx.textContent}`);
  });
  if (!played && rows.length) { played = true; if (!still()) scramble(rows); }
}

// one-time Solari scramble: every tile riffles through a few glyphs, row by row, then lands on its character
function scramble(rows) {
  const jobs = [];
  rows.forEach((b, r) => b.querySelectorAll(".fl").forEach((t, i) => {
    const fin = t.dataset.ch;
    if (fin === " ") return;
    t.textContent = " ";
    const steps = 3 + Math.floor(Math.random() * 4);
    jobs.push({ t, fin, at: 120 + r * 85 + i * 26 + Math.random() * 60, left: steps });
  }));
  const t0 = performance.now();
  const frame = (now) => {
    let busy = false;
    for (const j of jobs) {
      if (j.left < 0) continue;
      busy = true;
      if (now - t0 < j.at) continue;
      j.t.textContent = j.left === 0 ? j.fin : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      j.t.animate([{ transform: "perspective(240px) rotateX(-80deg)", filter: "brightness(1.6)" }, { transform: "none", filter: "none" }], { duration: 90, easing: "ease-out" });
      j.left--; j.at += 70;
    }
    if (busy) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ live readouts + service notice
const hhmm = (d) => d.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", hour12: false });
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fday = (s) => new Date(String(s).slice(0, 10) + "T12:00");
const dayLbl = (s) => fday(s).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" }).replace(/\./g, "").toUpperCase();
function level(v) {
  const L = S.D.ferry.levels;
  return v >= L.p97 ? "Packed" : v >= L.p90 ? "Very busy" : v >= L.p75 ? "Busy" : v >= L.p50 ? "Moderate" : "Quiet";
}

function update() {
  if (!built) return;
  const set = (k, v) => built.strip.querySelectorAll(`[data-k="${k}"]`).forEach((n) => { n.textContent = v; });
  const { D, bikes, ts } = S;
  const notes = [];
  if (bikes) {
    const tot = bikes.reduce((a, b) => a + b.bikes, 0), eb = bikes.reduce((a, b) => a + b.ebikes, 0);
    const empty = bikes.filter((b) => b.on && b.bikes === 0).length, docks = bikes.reduce((a, b) => a + b.docks, 0);
    set("bikes", n0(tot)); set("ebikes", n0(eb)); set("empty", n0(empty));
    notes.push(`Bike Share: ${n0(tot)} bikes docked across ${n0(bikes.length)} stations, ${n0(docks)} free docks, ${n0(empty)} stations empty`);
  }
  if (D) {
    const F = D.ferry.forecast;
    const td = F.find((f) => f.date.slice(0, 10) === ymd(new Date())) || F[0];
    const lvl = level(td.pred);
    set("ferry", n0(td.pred)); set("ferryLvl", lvl);
    built.strip.querySelector('[data-k="ferryLvl"]').dataset.level = lvl.toLowerCase().replace(/\s+/g, "-");
    const T = D.ttc, i = T.monthly.months.length - 1;
    const mins = Object.keys(T.lines).reduce((a, ln) => a + ((T.monthly[ln] || [])[i] || 0), 0);
    set("ttcLbl", `TTC delay · ${fday(T.monthly.months[i]).toLocaleDateString("en-CA", { month: "short" }).replace(".", "")}`);
    set("ttc", `${n0(mins)} min`);
    const hi = F.reduce((a, b) => (b.pred > a.pred ? b : a)), lo = F.reduce((a, b) => (b.pred < a.pred ? b : a));
    const pk = td.hourly.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    notes.unshift(
      `Island ferry: busiest day this week ${dayLbl(hi.date)}${hi.holiday ? ` (${hi.holiday})` : ""}, about ${n0(hi.pred)} riders`,
      `Quietest crossing ${dayLbl(lo.date)}, about ${n0(lo.pred)} riders`,
      `Today's boarding peaks around ${pk % 12 || 12} ${pk < 12 ? "am" : "pm"}`);
    if (T.causes?.length) notes.push(`TTC subway: ${T.causes[0][1]} is the top cause of delay since ${fday(T.from).getFullYear()}, ${n0(T.causes[0][2] / 60)} hours lost`);
    if (!ts) set("asof", hhmm(new Date(D.generated)));
  }
  if (ts) set("asof", hhmm(new Date(ts * 1000)));
  notes.push("Please stand clear of the doors");
  const run = built.board.querySelector(".db-tick-run");
  const line = notes.map((t) => t.toUpperCase()).join("   ◆   ") + "   ◆   ";
  run.replaceChildren(h("span", "", line), h("span", "", line));
  run.style.setProperty("--dur", `${Math.max(40, Math.round(line.length / 4))}s`);
}

// ------------------------------------------------------------------ basemap tint (tile wall grey by day, charcoal by night)
const TINT = {
  day: { bg: "#e9e7df", water: "#c2c7ca", green: "#dfe0d7", resi: "#e4e2da", bldg: "#dcdad2", road: "#fbfaf6", minor: "#f3f2ec", casing: "#cac8bf", rail: "#c6c4bb" },
  night: { bg: "#18191c", water: "#0e0f11", green: "#1e2023", resi: "#1b1c1f", bldg: "#212226", road: "#303136", minor: "#26272b", casing: "#37383d", rail: "#2a2b2f" },
};
function hookMap(map) {
  if (map.__dbHooked) return;
  map.__dbHooked = true;
  map.on("style.load", () => tint(map));
  if (map.isStyleLoaded()) tint(map);
}
function tint(map) {
  if (!on()) return; // Classic: main.js's setStyle() diff restores the stock basemap
  const P = dark() ? TINT.night : TINT.day;
  const set = (id, prop, v) => { try { map.setPaintProperty(id, prop, v); } catch { /* layer absent in this style */ } };
  for (const l of map.getStyle()?.layers || []) {
    const id = l.id;
    if (id === "bikes" || l.type === "symbol") continue;
    if (l.type === "background") set(id, "background-color", P.bg);
    else if (l.type === "fill") {
      if (/water/.test(id)) set(id, "fill-color", P.water);
      else if (/park|wood|grass|glacier|ice/.test(id)) set(id, "fill-color", P.green);
      else if (/building/.test(id)) { set(id, "fill-color", P.bldg); set(id, "fill-outline-color", P.casing); }
      else if (/landuse|pier|aeroway/.test(id)) set(id, "fill-color", P.resi);
    } else if (l.type === "line") {
      if (/waterway/.test(id)) set(id, "line-color", P.water);
      else if (/casing/.test(id)) set(id, "line-color", P.casing);
      else if (/rail/.test(id)) set(id, "line-color", /dash/.test(id) ? P.bg : P.rail);
      else if (/minor|path|pier|subtle|taxiway/.test(id)) set(id, "line-color", P.minor);
      else if (/highway|road|runway/.test(id)) set(id, "line-color", P.road);
    }
  }
}

// start (after every const above is initialised)
if (on()) { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build(); }
