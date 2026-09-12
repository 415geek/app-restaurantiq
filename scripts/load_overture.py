#!/usr/bin/env python3
"""
Load the Overture Maps *places* theme for one metro into Supabase `iq_poi`
(supabase/migrations/0009_iq_360_data_layer.sql). Monthly full refresh.

    python3 scripts/load_overture.py --metro sf-bay --release 2026-08-20.0
    python3 scripts/load_overture.py --metro sf-bay --release 2026-08-20.0 --dry-run
    python3 scripts/load_overture.py --metro sf-bay --release 2026-08-20.0 --limit 200 --out qa/out/overture_sample.json

Requirements: Python 3.10+, `pip install duckdb` (≥ 0.10). Optional: `pyyaml`
(reads the metro bbox from lib/iq/params/hubs.yaml; falls back to a hard-coded
sf-bay bbox when missing). Network: DuckDB reads the public Overture S3 bucket
anonymously via httpfs — no AWS credentials needed. Upserts go to Supabase via
PostgREST with the service-role key.

Env (only for the upsert step): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

Design notes
- The Overture places schema drifts between releases (e.g. `taxonomy` and
  `operating_status` landed after `categories`). Instead of hard-coding one
  shape we DESCRIBE the parquet once (metadata only), then build the projection
  from the columns that actually exist. Missing columns are emitted as NULL so
  the DB row shape is stable.
- Coordinates come from the point geometry when the spatial extension is
  available; otherwise from `bbox.xmin/ymin` (identical for point features).
- We keep only categories relevant to the 360° report: restaurants, cafés,
  bakeries, bubble tea / dessert, grocery / supermarket, banks and schools.
- Upsert uses `Prefer: resolution=merge-duplicates` on the `id` primary key.
  The payload deliberately omits `first_seen` (DB default on insert; untouched
  on update) and every `sub_cuisine*` column so the Phase 3 classifier output
  survives monthly refreshes. `last_seen` and `release` are updated each run.
- Rows that disappear from a release are NOT deleted here — `last_seen` going
  stale is the signal; a separate janitor can prune `last_seen < now - 90d`.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path
from typing import Any, Iterable

REPO_ROOT = Path(__file__).resolve().parents[1]
HUBS_YAML = REPO_ROOT / "lib" / "iq" / "params" / "hubs.yaml"

# Mirrors lib/iq/params/hubs.yaml `metro_bbox` — used only when PyYAML is unavailable.
FALLBACK_BBOX: dict[str, dict[str, float]] = {
    "sf-bay": {"min_lat": 37.20, "min_lng": -122.60, "max_lat": 38.05, "max_lng": -121.70},
}

# Overture category slugs we care about (LIKE patterns against categories.primary).
CATEGORY_PATTERNS: tuple[str, ...] = (
    "%restaurant%",
    "%cafe%",
    "%coffee%",
    "%bakery%",
    "%bubble_tea%",
    "%boba%",
    "%dessert%",
    "%ice_cream%",
    "%tea_house%",
    "%grocery%",
    "%supermarket%",
    "%bank%",
    "%school%",
)

OVERTURE_S3 = "s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*"
BATCH_SIZE = 500
UPSERT_RETRIES = 4


# --------------------------------------------------------------------------- args / bbox


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--metro", default="sf-bay", help="metro id (must match hubs.yaml `metro`)")
    p.add_argument("--release", required=True, help="Overture release tag, e.g. 2026-08-20.0")
    p.add_argument("--dry-run", action="store_true", help="query + summarize, write nothing to Supabase")
    p.add_argument("--limit", type=int, default=0, help="cap rows (smoke runs)")
    p.add_argument("--out", default="", help="also dump the rows as JSON to this path")
    p.add_argument("--threads", type=int, default=4, help="DuckDB threads")
    return p.parse_args(argv)


def load_metro_bbox(metro: str) -> dict[str, float]:
    """Read `metro_bbox` from hubs.yaml (PyYAML) or fall back to the hard-coded table."""
    try:
        import yaml  # type: ignore

        with HUBS_YAML.open("r", encoding="utf-8") as fh:
            doc = yaml.safe_load(fh)
        if doc and doc.get("metro") == metro and isinstance(doc.get("metro_bbox"), dict):
            b = doc["metro_bbox"]
            return {k: float(b[k]) for k in ("min_lat", "min_lng", "max_lat", "max_lng")}
        print(f"[load_overture] hubs.yaml metro={doc.get('metro') if doc else None!r} != {metro!r}; using fallback bbox", file=sys.stderr)
    except ImportError:
        print("[load_overture] PyYAML not installed; using hard-coded bbox", file=sys.stderr)
    except Exception as exc:  # noqa: BLE001 — any yaml/IO issue falls back
        print(f"[load_overture] could not read {HUBS_YAML}: {exc}; using fallback bbox", file=sys.stderr)
    if metro not in FALLBACK_BBOX:
        raise SystemExit(f"[load_overture] no bbox known for metro {metro!r}; add it to hubs.yaml")
    return FALLBACK_BBOX[metro]


# --------------------------------------------------------------------------- duckdb


def connect_duckdb(threads: int):
    try:
        import duckdb  # type: ignore
    except ImportError as exc:
        raise SystemExit("[load_overture] `pip install duckdb` is required") from exc
    con = duckdb.connect()
    con.execute(f"SET threads TO {int(threads)}")
    con.execute("INSTALL httpfs; LOAD httpfs;")
    # Public bucket: anonymous access, region pinned so the S3 SDK does not probe.
    con.execute("SET s3_region='us-west-2';")
    try:
        con.execute("SET s3_use_ssl=true;")
    except Exception:  # noqa: BLE001 — setting name varies by version
        pass
    spatial = True
    try:
        con.execute("INSTALL spatial; LOAD spatial;")
    except Exception as exc:  # noqa: BLE001
        spatial = False
        print(f"[load_overture] spatial extension unavailable ({exc}); using bbox for coordinates", file=sys.stderr)
    return con, spatial


def describe_columns(con, source: str) -> dict[str, str]:
    """Column name → DuckDB type for the parquet dataset (reads footer metadata only)."""
    rows = con.execute(f"DESCRIBE SELECT * FROM read_parquet('{source}', hive_partitioning=1) LIMIT 0").fetchall()
    return {r[0]: r[1] for r in rows}


def build_query(source: str, cols: dict[str, str], bbox: dict[str, float], spatial: bool, limit: int) -> str:
    """Projection adapts to the columns present in this release."""
    has = cols.__contains__

    if spatial and has("geometry"):
        # `geometry` is WKB in most releases; newer duckdb+spatial may already expose GEOMETRY.
        geom_expr = "ST_GeomFromWKB(geometry)" if "BLOB" in cols["geometry"].upper() else "geometry"
        lng_expr, lat_expr = f"ST_X({geom_expr})", f"ST_Y({geom_expr})"
    else:
        lng_expr, lat_expr = "bbox.xmin", "bbox.ymin"

    name_expr = "names.primary" if has("names") else "NULL"
    common_expr = "to_json(names.common)" if has("names") else "NULL"
    cat_primary = "categories.primary" if has("categories") else "NULL"
    cat_alt = "categories.alternate" if has("categories") else "NULL"
    # `taxonomy` replaces `categories` in newer schemas (a list of slugs, most specific last).
    taxonomy_expr = "taxonomy" if has("taxonomy") else "NULL"
    status_expr = "operating_status" if has("operating_status") else "NULL"
    confidence_expr = "confidence" if has("confidence") else "NULL"
    brand_expr = "brand.names.primary" if has("brand") else "NULL"
    address_expr = "addresses[1].freeform" if has("addresses") else "NULL"
    sources_expr = "to_json(sources)" if has("sources") else "NULL"

    cat_filter_col = cat_primary if has("categories") else "list_last(taxonomy)" if has("taxonomy") else None
    if cat_filter_col is None:
        raise SystemExit("[load_overture] parquet has neither `categories` nor `taxonomy`; cannot filter")
    like_clauses = " OR ".join(f"{cat_filter_col} LIKE '{pat}'" for pat in CATEGORY_PATTERNS)

    limit_clause = f"LIMIT {int(limit)}" if limit > 0 else ""
    return f"""
        SELECT
            id,
            {name_expr}       AS name,
            {common_expr}     AS names_common_json,
            {lng_expr}        AS lng,
            {lat_expr}        AS lat,
            {cat_primary}     AS primary_category,
            {cat_alt}         AS alternate_categories,
            {taxonomy_expr}   AS taxonomy,
            {status_expr}     AS operating_status,
            {confidence_expr} AS confidence,
            {brand_expr}      AS brand,
            {address_expr}    AS address,
            {sources_expr}    AS sources_json
        FROM read_parquet('{source}', hive_partitioning=1)
        WHERE bbox.xmin >= {bbox['min_lng']} AND bbox.xmax <= {bbox['max_lng']}
          AND bbox.ymin >= {bbox['min_lat']} AND bbox.ymax <= {bbox['max_lat']}
          AND ({like_clauses})
        {limit_clause}
    """


# --------------------------------------------------------------------------- row shaping


def _json_or_none(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, (dict, list)):
        return v
    if isinstance(v, str):
        try:
            return json.loads(v)
        except ValueError:
            return None
    return None


def to_row(rec: dict[str, Any], metro: str, release: str, today: str) -> dict[str, Any] | None:
    lat, lng = rec.get("lat"), rec.get("lng")
    if lat is None or lng is None or not rec.get("id"):
        return None
    taxonomy = rec.get("taxonomy")
    if not taxonomy:
        # Fallback path while `taxonomy` lands: primary + alternates.
        alt = rec.get("alternate_categories") or []
        taxonomy = [c for c in [rec.get("primary_category"), *alt] if c]
    common = _json_or_none(rec.get("names_common_json"))
    names_json = {"primary": rec.get("name"), "common": common if isinstance(common, dict) else None}
    status = rec.get("operating_status") or "unknown"
    return {
        "id": rec["id"],
        "metro": metro,
        "name": rec.get("name"),
        "names_json": names_json,
        "lat": float(lat),
        "lng": float(lng),
        "taxonomy_path": list(taxonomy),
        "primary_category": rec.get("primary_category") or (taxonomy[-1] if taxonomy else None),
        "operating_status": status,
        "confidence": float(rec["confidence"]) if rec.get("confidence") is not None else None,
        "brand": rec.get("brand"),
        "address": rec.get("address"),
        "sources_json": _json_or_none(rec.get("sources_json")),
        # first_seen: DB default on insert, never overwritten on merge.
        "last_seen": today,
        "release": release,
    }


def query_rows(con, sql: str) -> Iterable[dict[str, Any]]:
    cur = con.execute(sql)
    names = [d[0] for d in cur.description]
    while True:
        chunk = cur.fetchmany(2_000)
        if not chunk:
            break
        for tup in chunk:
            yield dict(zip(names, tup))


# --------------------------------------------------------------------------- supabase


def supabase_upsert(rows: list[dict[str, Any]], url: str, key: str) -> None:
    endpoint = f"{url.rstrip('/')}/rest/v1/iq_poi?on_conflict=id"
    body = json.dumps(rows, ensure_ascii=False, default=str).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    delay = 1.0
    for attempt in range(1, UPSERT_RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                if resp.status in (200, 201, 204):
                    return
                raise RuntimeError(f"unexpected status {resp.status}")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:400]
            # 4xx other than 429 will not succeed on retry — surface it.
            if 400 <= exc.code < 500 and exc.code != 429:
                raise SystemExit(f"[load_overture] upsert rejected ({exc.code}): {detail}") from exc
            print(f"[load_overture] upsert attempt {attempt} failed ({exc.code}): {detail}", file=sys.stderr)
        except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
            print(f"[load_overture] upsert attempt {attempt} failed: {exc}", file=sys.stderr)
        if attempt == UPSERT_RETRIES:
            raise SystemExit("[load_overture] giving up on upsert batch")
        time.sleep(delay)
        delay *= 2


# --------------------------------------------------------------------------- main


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    bbox = load_metro_bbox(args.metro)
    source = OVERTURE_S3.format(release=args.release)
    today = date.today().isoformat()
    print(f"[load_overture] metro={args.metro} release={args.release} bbox={bbox} dry_run={args.dry_run}")

    supa_url = os.environ.get("SUPABASE_URL", "").strip().strip('"')
    supa_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip().strip('"')
    if not args.dry_run and (not supa_url or not supa_key):
        print("[load_overture] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (use --dry-run to skip the write)", file=sys.stderr)
        return 2

    con, spatial = connect_duckdb(args.threads)
    t0 = time.time()
    cols = describe_columns(con, source)
    print(f"[load_overture] parquet columns: {', '.join(sorted(cols))}")
    sql = build_query(source, cols, bbox, spatial, args.limit)

    rows: list[dict[str, Any]] = []
    skipped = 0
    by_category: dict[str, int] = {}
    by_status: dict[str, int] = {}
    for rec in query_rows(con, sql):
        row = to_row(rec, args.metro, args.release, today)
        if row is None:
            skipped += 1
            continue
        rows.append(row)
        by_category[row["primary_category"] or "?"] = by_category.get(row["primary_category"] or "?", 0) + 1
        by_status[row["operating_status"]] = by_status.get(row["operating_status"], 0) + 1
    print(f"[load_overture] {len(rows)} rows ({skipped} skipped) in {time.time() - t0:.1f}s")
    top = sorted(by_category.items(), key=lambda kv: -kv[1])[:15]
    print("[load_overture] top categories: " + ", ".join(f"{k}={v}" for k, v in top))
    print("[load_overture] operating_status: " + ", ".join(f"{k}={v}" for k, v in sorted(by_status.items())))

    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(rows, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        print(f"[load_overture] wrote {out}")

    if args.dry_run:
        for r in rows[:3]:
            print(json.dumps(r, ensure_ascii=False, default=str)[:300])
        print("[load_overture] dry run — nothing written to Supabase")
        return 0

    t1 = time.time()
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        supabase_upsert(batch, supa_url, supa_key)
        print(f"[load_overture] upserted {min(i + BATCH_SIZE, len(rows))}/{len(rows)}", end="\r", flush=True)
    print(f"\n[load_overture] done: {len(rows)} rows upserted in {time.time() - t1:.1f}s (release {args.release})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
