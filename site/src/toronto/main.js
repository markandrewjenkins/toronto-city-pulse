// Toronto City Pulse: four topic modules (ferry, bike, ttc, weather) in the shared console (../shared/console.js).
// Inverted pyramid: Overview → topic (key numbers + one main view per sub-topic) → item (detail drawer).
import { initTheme, initSkin } from "../shared/ui.js";
import { createConsole } from "../shared/console.js";
import { T, day, fDayLong, syncSel } from "./common.js";
import { ferry } from "./ferry.js";
import { bike } from "./bike.js";
import { ttc } from "./ttc.js";
import { weather } from "./weather.js";
import { pulse } from "./skin.js";

T.isDark = initTheme(document.getElementById("theme"));
initSkin(document.getElementById("skin"));

const about = {
  eyebrow: "About & method", heading: "How this dashboard is made", class: "pane-about",
  html: `
    <div class="card prose">
      <h3>Method</h3>
      <p><b>Demand models.</b> Daily ferry riders and Bike Share trips are modelled with Poisson gradient boosting on weather (high, low, rain) and calendar (weekday, Ontario holidays, season, school break, pandemic period). The ferry model also sees average ridership from one to five weeks earlier, which is known a week ahead and absorbs service changes. Both are tested on 2025–2026 days they never saw, and the 80% ranges come from those test errors.</p>
      <p><b>Forecasts.</b> The forecasts run on Environment Canada's GEM weather forecast via Open-Meteo. Hourly crowd shapes come from the share of riders per hour for that kind of day and month over the last three seasons.</p>
      <p><b>TTC.</b> Delays with lost minutes, joined to the TTC's incident-code descriptions.</p>
      <p><b>Reading this dashboard.</b> The Overview gives one headline per topic. Each topic on the left opens its key numbers and one main view per sub-topic; clicking a day, station, cause or hour opens its detail in a side drawer. Every state has its own link, so the back button and shared links work.</p>
    </div>
    <div class="card prose">
      <h3>Honest limitations</h3>
      <ul>
        <li>Ferry counts are tickets redeemed at Jack Layton Ferry Terminal, mostly outbound trips, so they measure demand rather than queue length. On the hottest Saturdays capacity caps the count, and the real crowd is bigger.</li>
        <li>Bike Share trip files are published monthly, so the trip model can't see the last few weeks. The 2025 files repeat the start station as the end station on every trip, so routes for that year are unusable, though daily trip counts are fine.</li>
        <li>The forecasts inherit weather-forecast error, especially for rain more than three days out.</li>
        <li>TTC delay codes are recorded by staff at the time. "Unknown" and catch-all codes hide some causes.</li>
      </ul>
    </div>
    <div class="card prose">
      <h3>Data sources</h3>
      <ul class="sources">
        <li><a href="https://open.toronto.ca/dataset/toronto-island-ferry-ticket-counts/">City of Toronto: Toronto Island Ferry Ticket Counts</a></li>
        <li><a href="https://open.toronto.ca/dataset/bike-share-toronto-ridership-data/">Bike Share Toronto ridership data</a> and the live <a href="https://tor.publicbikesystem.net/customer/gbfs/v2/gbfs.json">GBFS feed</a></li>
        <li><a href="https://open.toronto.ca/dataset/ttc-subway-delay-data/">TTC subway delay data</a></li>
        <li>All under the Open Government Licence – Toronto. Weather: Environment and Climate Change Canada; forecast via <a href="https://open-meteo.com/">Open-Meteo</a></li>
        <li>Basemap © <a href="https://openfreemap.org">OpenFreeMap</a>, © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a></li>
      </ul>
      <p class="note" id="generated"></p>
    </div>`,
};

T.ctx = { region: "toronto" }; // shared with the modules; the console adds route, go, href, refresh, theme…
createConsole({
  host: document.getElementById("app"),
  title: "Toronto City Pulse",
  kicker: () => {
    if (!T.D) return "Toronto today";
    const f = T.D.ferry.forecast[T.sel];
    return `Forecast for ${fDayLong(day(f.date))}${f.holiday ? ` · ${f.holiday}` : ""}`;
  },
  heading: "The city at a glance",
  note: "Four live and forecast feeds from the City of Toronto's open data. Pick a tile, or a topic in the menu, to go a level deeper.",
  modules: [ferry, bike, ttc, weather],
  about,
  foot: `<p>Built entirely on free, open data. Bike availability is live; everything else refreshes daily.</p><p class="note" id="generated-rail"></p>`,
  ctx: T.ctx,
  onRoute: (r) => syncSel(r),
});
pulse({}); // "Departure Board" skin: build its board and live strip now that the console exists
