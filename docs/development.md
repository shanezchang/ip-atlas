# Development

## Structure

- `app.py`: FastAPI entrypoint, API validation, self-IP lookup.
- `plotip/ranges.py`: read-only SQLite queries, exact CIDR conversion, keyset pagination.
- `plotip/lookup.py`: IP classification, cached XDB buffers, lookup and map matching.
- `data/`: server-only XDB, read-only `ranges.sqlite`, place matches, hashes and provenance.
- `web/src/`: TypeScript UI, map controller and CSS tokens.
- `web/public/`: public map data, logo and dependency licenses.
- `public/`: generated frontend; ignored by Git, built on deployment.
- `scripts/prepare_data.py`: rebuild coordinate matches, map assets and the reverse index via `scripts/build_ranges.py`.

Python dependencies are locked with uv; JavaScript dependencies with npm. There is no writable application database or external database service. `ranges.sqlite` is a versioned, immutable data artifact. Query caching is bounded and instance-local; it is not a distributed cache.

## API

`POST /api/lookup` with `{"ip":"114.114.114.114"}` returns an IP record. Input is limited to 64 characters. Domains, CIDRs and IPv6 scope IDs are rejected. IPv4-mapped IPv6 addresses are normalized to IPv4.

`GET /api/me` resolves the Vercel-owned forwarding header in production; locally it uses the connection address. Never trust arbitrary client headers on a generic reverse proxy without adapting this logic.

`GET /api/health` returns the data snapshot version. `/api/docs` exposes OpenAPI. Lookup responses are `no-store`. The public demo is not a bulk API and has no availability guarantee.

### Reverse lookup

- `GET /api/areas` returns countries; `?country=US` returns that country's state/province choices.
- `GET /api/ranges?area=country:US&version=4` or `area=region:USA-3519` returns up to 20 original intervals. Use the returned `next_cursor` as `after` for the next page. `version` accepts 4 or 6.
- `address_count` is a decimal string, including for IPv6. `cidrs` is the exact minimal CIDR decomposition of each interval. Records retain upstream region/city/network text.
- Counts are precomputed. Composite country/version and region/version indexes support keyset pagination in source-IP order. Region aliases use the same conservative canonical-name priority as forward mapping; ambiguous regions are country-only.
- SQLite opens with `mode=ro&immutable=1`, uses the standard library, and stays outside the public directory. The browser receives a page, not the database. Read-only range/catalog responses may be CDN-cached; individual IP lookups remain no-store.

## Verification

`uv run --locked pytest` checks the real bundled IPv4 / IPv6 data, reference-point precision, non-public and invalid inputs, failure responses, forwarded-header trust, concurrency, exact CIDRs and server-only data boundaries. `uv run --locked ruff check .` is the Python lint gate. `npm test` executes the real TypeScript analytics filters with Node's built-in test runner (no SDK injection or network); `npm run lint` checks the existing Prettier style; `npm run typecheck` covers application and browser-test TypeScript.

`npm run test:e2e` builds the production frontend and starts an isolated FastAPI server on port 8019; stop any existing process on that port first. It does not reuse an unrelated server or test only Vite's dev output. `BASE_URL=http://127.0.0.1:<port> npm run test:e2e` uses an explicitly managed local build instead. Browser requests are allowlisted to that origin's static resources and read-only lookup APIs; external services, collectors and other writes are blocked. Never remove that guard to manufacture production analytics.

The browser suite covers the existing country/state → pagination → IPv6 CIDR clipboard → first-IP lookup journey, English/Chinese, light/dark, keyboard focus, network/503/catalog retries, actual empty ranges, explicit no-record/clipboard-denial fixtures, map failure and 320/390/1440px layouts. Map-label tests measure rendered text bounds after fonts load, translation, zoom, pan and resize rather than merely checking page overflow. Synthetic fixtures verify recovery UI, not live data attribution. Missing data fields remain honest; no paid providers or client-IP discovery services are used.

## Updating data

1. Fetch the upstream ip2region repository and choose a reviewed commit. Keep the XDB files and raw source files from the same commit.
2. Download these Natural Earth snapshots to the ignored `.cache/` folder:

```sh
mkdir -p .cache
curl -fL https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_50m_admin_0_countries.geojson -o .cache/countries.geojson
curl -fL https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_10m_admin_1_states_provinces.geojson -o .cache/provinces.geojson
uv run python scripts/prepare_data.py --ip2region /absolute/path/to/ip2region
```

3. The script copies the XDB files and builds country-scoped, normalized name matches from GeoNames. It uses the matching admin division where available; ambiguous city candidates fall back instead of guessing. Natural Earth coordinates are reference points, not calculated population centroids.
4. The same source snapshot produces `data/ranges.sqlite`. The build excludes unknown countries and non-public intervals, interns original locality/network text, and builds range indexes and per-area counts. SQLite file size must remain under GitHub’s per-file limit and the deployment function bundle limit. Its hash and record counts are recorded in the manifest.
5. Review `data/manifest.json`, source licenses and changed results. Update attribution if snapshots change. Run checks, then commit the generated data with the source changes.

City coverage is incomplete (GeoNames cities of population 15,000+); exact names and admin codes do not always align. Missing fields remain missing. Map coordinates are never inferred from IP numeric values or generated by a model.

## Frontend details

MapLibre 6's worker is explicitly imported with Vite's `?worker&url` and registered using `setWorkerUrl`. This bundles its shared-module imports correctly. Keep this wiring when upgrading. Text from lookup responses is escaped before insertion; marker labels use `textContent`.
