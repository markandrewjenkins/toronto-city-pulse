"""Toronto City Pulse configuration."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "toronto" / "raw"
OUT = ROOT / "site" / "public" / "data" / "toronto"

CKAN = "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action"
FERRY_RESOURCE = "0da005de-270d-49d1-b45b-32e2e777a381"
BIKESHARE_PACKAGE = "bike-share-toronto-ridership-data"
BIKESHARE_YEARS = [2023, 2024, 2025, 2026]
TTC_PACKAGE = "ttc-subway-delay-data"
TTC_YEARS = [2022, 2023, 2024]

WEATHER_DAILY = ["6158355"]          # Toronto City (daily climate, long record)
LAT, LON = 43.64, -79.38
GBFS = "https://tor.publicbikesystem.net/customer/gbfs/v2/gbfs.json"
