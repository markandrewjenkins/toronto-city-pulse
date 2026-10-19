"""Download inputs for Toronto City Pulse.

  python -m pipelines.toronto.fetch [ferry|weather|bikeshare|ttc|all]
"""
from __future__ import annotations

import io
import sys
import zipfile

import pandas as pd
import requests

from pipelines.common.eccc import climate_daily
from pipelines.common.http import USER_AGENT, get_json

from .config import BIKESHARE_PACKAGE, BIKESHARE_YEARS, CKAN, FERRY_RESOURCE, RAW, TTC_PACKAGE, TTC_YEARS, WEATHER_DAILY

S = requests.Session()
S.headers["User-Agent"] = USER_AGENT


def save(df: pd.DataFrame, name: str) -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    df.to_parquet(RAW / f"{name}.parquet", index=False)


def package(pid: str) -> list[dict]:
    return get_json(f"{CKAN}/package_show", {"id": pid})["result"]["resources"]


def ferry() -> None:
    r = S.get(f"https://ckan0.cf.opendata.inter.prod-toronto.ca/datastore/dump/{FERRY_RESOURCE}", timeout=300)
    r.raise_for_status()
    df = pd.read_csv(io.StringIO(r.text))
    df = df.rename(columns={"Timestamp": "t", "Redemption Count": "redeemed", "Sales Count": "sold"}).drop(columns=["_id"])
    df["t"] = pd.to_datetime(df.t)
    save(df.sort_values("t"), "ferry")
    print(f"  ferry: {len(df):,} 15-minute rows {df.t.min():%Y-%m-%d} → {df.t.max():%Y-%m-%d %H:%M}", flush=True)


def weather() -> None:
    frames = []
    for sid in WEATHER_DAILY:
        d = climate_daily(sid, start="2014-01-01")
        d["station"] = sid
        frames.append(d)
    df = pd.concat(frames)
    save(df, "weather")
    print(f"  weather: {len(df):,} days through {df.date.max():%Y-%m-%d}", flush=True)


def bikeshare() -> None:
    """Stream each year's trip files and keep only aggregates (daily, hour×weekday, stations, routes).
    Past years are cached as aggregates; only the current year is re-downloaded."""
    from datetime import date as _date
    res = {r["name"]: r["url"] for r in package(BIKESHARE_PACKAGE)}
    cache = RAW / "bike_years"
    cache.mkdir(parents=True, exist_ok=True)
    for y in BIKESHARE_YEARS:
        done = cache / f"{y}_daily.parquet"
        if done.exists() and y < _date.today().year:
            continue
        url = next((u for n, u in res.items() if n.startswith(f"bikeshare-ridership-{y}")), None)
        if not url:
            continue
        print(f"  bike share {y}: downloading…", flush=True)
        z = zipfile.ZipFile(io.BytesIO(S.get(url, timeout=1800).content))
        daily, hourly, stations, routes = [], [], [], []
        for name in z.namelist():
            if not name.lower().endswith(".csv"):
                continue
            with z.open(name) as f:
                df = pd.read_csv(f, encoding="latin-1", low_memory=False)
            df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
            tcol = next(c for c in df.columns if c.startswith("start_time"))
            df = df.assign(t=pd.to_datetime(df[tcol], errors="coerce", format="mixed")).dropna(subset=["t"])
            daily.append(df.groupby(df.t.dt.normalize().rename("date")).size().rename("trips"))
            hourly.append(df.groupby([df.t.dt.dayofweek.rename("dow"), df.t.dt.hour.rename("hour")]).size().rename("trips"))
            s_nm, e_nm = "start_station_name", "end_station_name"
            if s_nm in df:
                stations.append(df.groupby(s_nm).size().rename("trips"))
            if s_nm in df and e_nm in df:
                same = float((df[s_nm] == df[e_nm]).mean())
                if same > 0.3:          # data-quality guard: a file where most trips "return" to the start is malformed
                    print(f"    skipping routes in {name}: {same:.0%} of trips start and end at the same station", flush=True)
                else:
                    routes.append(df.groupby([s_nm, e_nm]).size().rename("trips"))
        pd.concat(daily).groupby(level=0).sum().reset_index().to_parquet(cache / f"{y}_daily.parquet", index=False)
        pd.concat(hourly).groupby(level=[0, 1]).sum().reset_index().to_parquet(cache / f"{y}_hourly.parquet", index=False)
        pd.concat(stations).groupby(level=0).sum().rename_axis("station").reset_index().to_parquet(cache / f"{y}_stations.parquet", index=False)
        if routes:
            pd.concat(routes).groupby(level=[0, 1]).sum().rename_axis(["start", "end"]).reset_index().to_parquet(cache / f"{y}_routes.parquet", index=False)
        print(f"    {y}: {int(pd.read_parquet(cache / f'{y}_daily.parquet').trips.sum()):,} trips", flush=True)
    load = lambda kind: pd.concat([pd.read_parquet(f) for f in sorted(cache.glob(f"*_{kind}.parquet"))], ignore_index=True)
    save(load("daily").groupby("date").trips.sum().reset_index(), "bike_daily")
    save(load("hourly").groupby(["dow", "hour"]).trips.sum().reset_index(), "bike_hourly")
    save(load("stations").groupby("station").trips.sum().reset_index(), "bike_stations")
    rt = load("routes").groupby(["start", "end"]).trips.sum().reset_index()
    save(rt.sort_values("trips", ascending=False).head(500), "bike_routes")


def ttc() -> None:
    res = package(TTC_PACKAGE)
    frames = []
    for r in res:
        n = r["name"].lower()
        url = r["url"]
        if any(f"data-{y}" in n for y in TTC_YEARS) and r["format"].upper() == "XLSX":
            xl = pd.read_excel(io.BytesIO(S.get(url, timeout=300).content), sheet_name=None)
            for sheet in xl.values():
                frames.append(sheet)
        elif n.startswith("ttc subway delay data since 2025") and r.get("datastore_active"):
            frames.append(pd.read_csv(io.StringIO(S.get(url, timeout=300).text)))
        elif n == "ttc-subway-delay-codes":
            codes = pd.read_excel(io.BytesIO(S.get(url, timeout=300).content))
            save(codes.astype(str), "ttc_codes")
    df = pd.concat(frames, ignore_index=True)
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    df = df.drop(columns=[c for c in df.columns if c.startswith("_id")], errors="ignore")
    save(df.astype({c: str for c in df.columns if df[c].dtype == object}), "ttc_delays")
    print(f"  TTC delays: {len(df):,} rows · columns {list(df.columns)}", flush=True)


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    for name, fn in [("ferry", ferry), ("weather", weather), ("ttc", ttc), ("bikeshare", bikeshare)]:
        if what in (name, "all"):
            print(f"{name}…", flush=True)
            fn()
