# Toronto City Pulse

Island ferry crowd forecast, live Bike Share, TTC delay patterns. Region: Toronto.

**Live dashboard: https://markandrewjenkins.github.io/toronto-city-pulse/**

Built only on free, open government and citizen-science data. A Python pipeline fetches and models the data,
and a static Vite + d3 + MapLibre page presents it. GitHub Actions refreshes everything daily and publishes it
to GitHub Pages.

## Method in brief

- **Island ferry:** Poisson gradient boosting on daily riders (ticket redemptions, 2015–), with weather, Ontario holidays, season, school break and the ridership level 1–5 weeks earlier.
  - Tested on 2025–26: mean absolute error ≈1,010 riders vs 1,560 for same-weekday-same-month, R² 0.88.
  - Intervals are calibrated on the first half of the test period and checked on the second (71% inside the 80% band).
- **Bike Share:** The same approach on daily trips (2023–). It's 14% better than the baseline, a modest gain stated as such. Live station availability comes from GBFS in the browser.
- **TTC:** Subway delay log 2022–, decoded with the TTC's incident codes.

## Design

The page has a Classic design and a themed alternative, **Departure Board** (subway tile wall / platform at night, with a split-flap ferry board), switched with the
button in the top bar or with `?skin=alt` / `?skin=classic` in the URL. Each has a day and a night version.

## Running locally

```bash
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt   # macOS/Linux: .venv/bin/pip
.venv/Scripts/python -m pipelines.toronto.fetch ferry
.venv/Scripts/python -m pipelines.toronto.fetch weather
.venv/Scripts/python -m pipelines.toronto.fetch ttc
.venv/Scripts/python -m pipelines.toronto.fetch bikeshare
.venv/Scripts/python -m pipelines.toronto.build
cd site && npm ci && npm run dev
```

Data licences are listed at the foot of the dashboard.
