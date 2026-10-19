"""Toronto City Pulse: ferry and bike-share demand forecasts, TTC subway delay patterns.

  python -m pipelines.toronto.build

Demand models
    Daily Toronto Island ferry riders (ticket redemptions) and daily Bike Share trips, modelled
    with Poisson gradient boosting on weather (high, low, rain) and calendar (weekday, holiday,
    season, school break). The ferry model also sees the ridership level of 1–5 weeks earlier,
    which captures service changes and post-pandemic recovery. Tested on 2025–2026 days it never
    saw, against a same-weekday-same-month baseline; intervals from test residuals. Forecasts use
    the Environment Canada GEM model (via Open-Meteo).
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

import holidays
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

from pipelines.common.http import get_json

from .config import LAT, LON, OUT, RAW

SPLIT = pd.Timestamp("2025-01-01")
ON_HOL = holidays.Canada(prov="ON", years=range(2014, 2032))


def clean(o):
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, np.ndarray):
        return clean(o.tolist())
    if isinstance(o, (float, np.floating)):
        return None if not np.isfinite(o) else round(float(o), 4)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, (pd.Timestamp, datetime, date)):
        return o.isoformat()[:10]
    return o


def dump(name, obj):
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / name, "w", encoding="utf-8") as f:
        json.dump(clean(obj), f, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    print(f"  wrote {name} ({(OUT / name).stat().st_size / 1024:,.0f} KB)")


# ============================================================================= features

def calendar(idx: pd.DatetimeIndex) -> pd.DataFrame:
    df = pd.DataFrame(index=idx)
    df["dow"] = idx.dayofweek
    df["holiday"] = [int(d.date() in ON_HOL) for d in idx]
    df["day_off"] = ((df.dow >= 5) | (df.holiday == 1)).astype(int)
    doy = idx.dayofyear
    df["doy_sin"], df["doy_cos"] = np.sin(2 * np.pi * doy / 365.25), np.cos(2 * np.pi * doy / 365.25)
    df["school_break"] = (((idx.month == 7) | (idx.month == 8) | ((idx.month == 6) & (idx.day >= 27))) ).astype(int)
    df["covid"] = ((idx >= "2020-03-15") & (idx < "2021-07-01")).astype(int)
    return df


def weather_frame(raw: pd.DataFrame) -> pd.DataFrame:
    w = raw.set_index("date")[["tmax", "tmin", "precip"]].sort_index()
    w = w[~w.index.duplicated()].asfreq("D")
    w[["tmax", "tmin"]] = w[["tmax", "tmin"]].interpolate(limit=3)
    w["precip"] = w.precip.fillna(0)
    return w


def forecast_weather(days: int = 8) -> pd.DataFrame:
    d = get_json("https://api.open-meteo.com/v1/forecast", {
        "latitude": LAT, "longitude": LON, "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum",
        "models": "gem_seamless", "past_days": 7, "forecast_days": days, "timezone": "America/Toronto"})
    return pd.DataFrame({"tmax": d["daily"]["temperature_2m_max"], "tmin": d["daily"]["temperature_2m_min"],
                         "precip": d["daily"]["precipitation_sum"]}, index=pd.to_datetime(d["daily"]["time"]))


WEATHER_F = ["tmax", "tmin", "precip", "wet"]
CAL_F = ["dow", "holiday", "day_off", "doy_sin", "doy_cos", "school_break", "covid"]


def design(target: pd.Series, w: pd.DataFrame, level: bool) -> pd.DataFrame:
    idx = target.index.union(w.index)
    X = calendar(idx).join(w)
    X["wet"] = (X.precip >= 1).astype(int)
    if level:
        # ridership level 7–35 days earlier: known a week ahead, tracks service changes and recovery
        lvl = target.reindex(idx).shift(7).rolling(28, min_periods=10).mean()
        X["level"] = np.log1p(lvl)
    X["y"] = target.reindex(idx)
    return X


def gbm():
    return HistGradientBoostingRegressor(loss="poisson", max_iter=500, learning_rate=0.04, max_leaf_nodes=31,
                                         min_samples_leaf=20, l2_regularization=1.0, random_state=11)


def demand_model(name: str, target: pd.Series, w: pd.DataFrame, level: bool, fw: pd.DataFrame, today: pd.Timestamp):
    feats = CAL_F + WEATHER_F + (["level"] if level else [])
    X = design(target, pd.concat([w, fw[fw.index > w.index.max()]]), level)
    hist = X.dropna(subset=["y", "tmax"] + (["level"] if level else []))
    tr, te = hist[hist.index < SPLIT], hist[hist.index >= SPLIT]
    m = gbm().fit(tr[feats], tr.y)
    pte = m.predict(te[feats])
    # baseline: same weekday, same month, average of the previous three years
    base = []
    for d_ in te.index:
        past = hist[(hist.index.month == d_.month) & (hist.index.dayofweek == d_.dayofweek) &
                    (hist.index.year >= d_.year - 3) & (hist.index.year < d_.year)].y
        base.append(past.mean() if len(past) else np.nan)
    base = np.array(base)
    y = te.y.to_numpy()
    busy = y >= np.percentile(y, 50)
    ratio = np.log((y + 50) / (pte + 50))
    half = len(ratio) // 2
    qh = np.quantile(ratio[:half], [0.1, 0.9])            # interval from the first half of the test period…
    cover_honest = float(np.mean((ratio[half:] >= qh[0]) & (ratio[half:] <= qh[1])))   # …checked on the second
    q = np.quantile(ratio, [0.1, 0.9])
    metrics = {
        "mae": float(np.mean(np.abs(pte - y))), "mae_base": float(np.nanmean(np.abs(base - y))),
        "mape_busy": float(np.mean(np.abs(pte - y)[busy] / y[busy])), "mape_busy_base": float(np.nanmean(np.abs(base - y)[busy] / y[busy])),
        "r2": float(1 - np.sum((y - pte) ** 2) / np.sum((y - y.mean()) ** 2)),
        "coverage80": cover_honest, "n_test": int(len(te)), "n_train": int(len(tr)),
        "train_from": tr.index.min(), "test_from": te.index.min(), "test_to": te.index.max(),
    }
    # grouped permutation importance on the test set
    groups = {"Weather": WEATHER_F, "Weekday & holidays": ["dow", "holiday", "day_off"], "Season & school break": ["doy_sin", "doy_cos", "school_break"],
              "Recent ridership level": ["level"] if level else [], "Pandemic period": ["covid"]}
    rng = np.random.default_rng(0)
    mae0 = metrics["mae"]
    imp = {}
    for g, cols in groups.items():
        if not cols:
            continue
        Xp = te[feats].copy()
        Xp[cols] = Xp[cols].to_numpy()[rng.permutation(len(Xp))]
        imp[g] = float(np.mean(np.abs(m.predict(Xp) - y)) - mae0)
    # refit on everything for the forecast
    mf = gbm().fit(hist[feats], hist.y)
    fut = X[(X.index >= today) & X.tmax.notna()].head(7)
    if level:
        fut = fut.assign(level=fut.level.fillna(hist.level.iloc[-1]))
    fp = mf.predict(fut[feats])
    fc = [{"date": d_, "pred": float(p), "lo": float(max(0, (p + 50) * np.exp(q[0]) - 50)), "hi": float((p + 50) * np.exp(q[1]) - 50),
           "tmax": float(r.tmax), "tmin": float(r.tmin), "precip": float(r.precip), "day_off": int(r.day_off), "holiday": ON_HOL.get(d_.date())}
          for d_, p, r in zip(fut.index, fp, fut.itertuples())]
    back = [[d_, float(o), float(p)] for d_, o, p in zip(te.index[-150:], y[-150:], pte[-150:])]
    print(f"  {name}: test MAE {metrics['mae']:.0f} vs baseline {metrics['mae_base']:.0f}; busy-day MAPE "
          f"{metrics['mape_busy']:.0%} vs {metrics['mape_busy_base']:.0%}; R² {metrics['r2']:.2f}; 80% cover {metrics['coverage80']:.0%}")
    return {"metrics": metrics, "importance": imp, "forecast": fc, "backtest": back}


# ============================================================================= main

def main():
    gen = datetime.now(timezone.utc).isoformat(timespec="minutes")
    w = weather_frame(pd.read_parquet(RAW / "weather.parquet"))
    fw = forecast_weather()
    # observed station data wins; the forecast fills the days the station hasn't reported yet
    w = w.combine_first(fw[["tmax", "tmin", "precip"]])
    today = pd.Timestamp(date.today())

    ferry = pd.read_parquet(RAW / "ferry.parquet")
    ferry["d"] = ferry.t.dt.normalize()
    fd = ferry.groupby("d").redeemed.sum()
    last_full = fd.index.max() - pd.Timedelta(days=1)
    fd_full = fd[fd.index <= last_full].asfreq("D", fill_value=0)
    ferry_model = demand_model("ferry", fd_full, w, True, fw, today)
    # hourly profile: share of the day's riders by hour, by day type and month, last three seasons
    recent = ferry[ferry.t >= ferry.t.max() - pd.DateOffset(years=3)].copy()
    recent["hour"], recent["month"] = recent.t.dt.hour, recent.t.dt.month
    recent["off"] = ((recent.t.dt.dayofweek >= 5) | recent.d.dt.date.map(lambda x: x in ON_HOL)).astype(int)
    hp = recent.groupby(["off", "month", "hour"]).redeemed.sum()
    hp = (hp / hp.groupby(level=[0, 1]).transform("sum")).round(4)
    for f in ferry_model["forecast"]:
        prof = hp.get((f["day_off"], f["date"].month), pd.Series(dtype=float))
        f["hourly"] = [[int(h), float(f["pred"] * prof.get(h, 0))] for h in range(6, 24)]
    today_rows = ferry[ferry.d == fd.index.max()]
    today_so_far = {"date": fd.index.max(), "redeemed": int(today_rows.redeemed.sum()),
                    "last_slot": today_rows.t.max(),
                    "hourly": today_rows.groupby(today_rows.t.dt.hour).redeemed.sum().to_dict()}
    # long-run patterns
    season = fd_full[fd_full.index >= "2022-01-01"]
    by_week = season.groupby(season.index.isocalendar().week).median()
    yearly = fd_full.groupby(fd_full.index.year).sum()
    summer = ferry[(ferry.t.dt.month.isin([6, 7, 8])) & (ferry.t >= "2023-01-01")]
    heat = summer.groupby([summer.t.dt.dayofweek, summer.t.dt.hour]).redeemed.mean()
    record = fd_full.sort_values(ascending=False).head(10)
    last2 = fd_full[fd_full.index >= fd_full.index.max() - pd.DateOffset(years=2)]
    levels = {f"p{q}": float(np.percentile(last2, q)) for q in (50, 75, 90, 97)}

    # bike share
    bd = pd.read_parquet(RAW / "bike_daily.parquet").set_index("date").trips
    bd.index = pd.to_datetime(bd.index)
    bd = bd[bd.index <= bd.index.max() - pd.Timedelta(days=1)].asfreq("D", fill_value=0)
    bike_model = demand_model("bike share", bd, w, False, fw, today)
    bh = pd.read_parquet(RAW / "bike_hourly.parquet")
    bst = pd.read_parquet(RAW / "bike_stations.parquet").sort_values("trips", ascending=False).head(15)
    brt = pd.read_parquet(RAW / "bike_routes.parquet")
    brt = brt.head(12)
    bike_monthly = bd.resample("MS").sum()

    # TTC
    ttc = ttc_patterns()

    dump("toronto.json", {
        "generated": gen,
        "ferry": {**ferry_model, "today": today_so_far, "levels": levels, "by_week": by_week.to_dict(), "yearly": yearly.to_dict(),
                  "heat": [[int(d_), int(h), float(v)] for (d_, h), v in heat.items()],
                  "records": [[d_, int(v)] for d_, v in record.items()], "last_full": last_full,
                  "history": [[d_, int(v)] for d_, v in fd_full[fd_full.index >= "2019-01-01"].resample("W").sum().items()]},
        "bike": {**bike_model, "monthly": [[d_, int(v)] for d_, v in bike_monthly.items()],
                 "hourly": bh.values.tolist(), "stations": bst.values.tolist(), "routes": brt.values.tolist(),
                 "data_through": bd.index.max(), "total_trips": int(bd.sum())},
        "ttc": ttc,
    })


def ttc_patterns() -> dict:
    df = pd.read_parquet(RAW / "ttc_delays.parquet")
    df.columns = [c.lower() for c in df.columns]
    df["date"] = pd.to_datetime(df["date"].str[:10], errors="coerce")
    df["hour"] = pd.to_numeric(df["time"].str[:2].str.replace(":", ""), errors="coerce")
    df["min_delay"] = pd.to_numeric(df.min_delay, errors="coerce").fillna(0)
    df["line"] = df.line.str.upper().str.strip().replace({"YU / BD": "YU/BD", "Y/BD": "YU/BD"})
    lines = {"YU": "Line 1 Yonge–University", "BD": "Line 2 Bloor–Danforth", "SHP": "Line 4 Sheppard", "SRT": "Line 3 Scarborough"}
    df = df[df.line.isin(lines) & df.date.notna()]
    codes = pd.read_parquet(RAW / "ttc_codes.parquet") if (RAW / "ttc_codes.parquet").exists() else None
    desc = {}
    if codes is not None:
        # the sheet holds side-by-side blocks: "<X> RMENU CODE" | "CODE DESCRIPTION"
        grid = codes.fillna("").astype(str).to_numpy()
        for r_ in range(grid.shape[0]):
            for c_ in range(grid.shape[1] - 1):
                code, text = grid[r_, c_].strip(), grid[r_, c_ + 1].strip()
                if code.isalnum() and code[:1].isalpha() and code.upper() == code and 2 <= len(code) <= 6 and text not in ("nan", "") and "CODE" not in code:
                    desc.setdefault(code, text)
    real = df[df.min_delay > 0]
    monthly = real.groupby([real.date.dt.to_period("M").dt.start_time, "line"]).min_delay.sum().unstack(fill_value=0)
    heat = real.groupby([real.date.dt.dayofweek, "hour"]).min_delay.sum()
    n_days = real.date.dt.normalize().nunique()
    cause = real.groupby("code").min_delay.agg(["sum", "size"]).sort_values("sum", ascending=False).head(12)
    station = real.groupby("station").min_delay.agg(["sum", "size"]).sort_values("sum", ascending=False).head(12)
    big = real[real.min_delay >= 10]
    print(f"  TTC: {len(real):,} delays with lost minutes, {real.date.min():%Y-%m} → {real.date.max():%Y-%m}")
    return {
        "lines": lines, "from": real.date.min(), "to": real.date.max(), "n": int(len(real)), "minutes": float(real.min_delay.sum()),
        "monthly": {"months": [d_ for d_ in monthly.index], **{ln: monthly[ln].tolist() for ln in monthly.columns}},
        "heat": [[int(d_), int(h), float(v) / max(n_days / 7, 1)] for (d_, h), v in heat.items() if 0 <= h <= 23],
        "causes": [[c, desc.get(c, c), float(r["sum"]), int(r["size"])] for c, r in cause.iterrows()],
        "stations": [[s.title(), float(r["sum"]), int(r["size"])] for s, r in station.iterrows()],
        "share_10min_by_line": {ln: float((big.line == ln).sum() / max((real.line == ln).sum(), 1)) for ln in lines},
    }


if __name__ == "__main__":
    main()
