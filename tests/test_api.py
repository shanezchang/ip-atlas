from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from app import app
from plotip.lookup import lookup

client = TestClient(app)


def test_ipv4_city_and_server_only_data():
    result = client.post("/api/lookup", json={"ip": "114.114.114.114"})
    assert result.status_code == 200
    data = result.json()
    assert data["city"] == "南京市"
    assert data["location"]["level"] == "city"
    assert 118 < data["location"]["longitude"] < 120
    assert result.headers["cache-control"] == "no-store"
    assert len(result.content) < 2000


def test_ipv6_and_country_fallback():
    d = lookup("240e:3b7:3272:d8d0:db09:c067:8d59:539e")
    assert d["version"] == 6 and d["city"] == "深圳市"
    assert d["location"]["level"] == "city"
    assert 113 < d["location"]["longitude"] < 115
    assert lookup("8.8.8.8")["location"]["level"] == "region"


@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1",
        "10.0.0.1",
        "::1",
        "fe80::1",
        "100.64.0.1",
        "192.0.2.1",
        "224.0.0.1",
        "2001:db8::1",
    ],
)
def test_non_public_never_gets_pin(ip):
    data = lookup(ip)
    assert data["scope"] != "public"
    assert data["location"] is None


@pytest.mark.parametrize(
    "ip",
    ["example.com", "999.1.1.1", "<script>", "fe80::1%en0", "1.2.3.4/24", "2001:::1", "   "],
)
def test_invalid_addresses(ip):
    assert client.post("/api/lookup", json={"ip": ip}).status_code == 400


def test_validation_and_mapped_ip():
    assert client.post("/api/lookup", json={"ip": "a" * 1000}).status_code == 422
    assert client.post("/api/lookup", json={}).status_code == 422
    assert client.post("/api/lookup", json={"ip": ""}).status_code == 422
    assert lookup("::ffff:114.114.114.114")["ip"] == "114.114.114.114"


def test_unavailable_data_is_an_explicit_retryable_error(monkeypatch):
    import sqlite3

    import app as api

    def failed_lookup(_ip):
        raise OSError("Synthetic unavailable lookup data")

    def failed_ranges(*_args):
        raise sqlite3.OperationalError("Synthetic unavailable reverse index")

    monkeypatch.setattr(api, "lookup", failed_lookup)
    monkeypatch.setattr(api, "list_ranges", failed_ranges)
    responses = [
        client.post("/api/lookup", json={"ip": "8.8.8.8"}),
        client.get("/api/ranges?area=country:US&version=4"),
    ]
    for response in responses:
        assert response.status_code == 503
        assert response.json() == {"detail": "data_unavailable"}


def test_untrusted_forward_header_is_ignored(monkeypatch):
    monkeypatch.delenv("VERCEL", raising=False)
    with TestClient(app, client=("127.0.0.1", 5000)) as local:
        result = local.get("/api/me", headers={"x-vercel-forwarded-for": "8.8.8.8"})
    assert result.json()["ip"] == "127.0.0.1"
    assert result.headers["cache-control"] == "private, no-store"


def test_concurrent_queries_remain_independent():
    ips = ["114.114.114.114", "8.8.8.8", "2001:4860:4860::8888"] * 20
    lookup.cache_clear()
    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(lookup, ips))
    assert all(result["ip"] == ip for result, ip in zip(results, ips))


def test_vercel_missing_paths_without_frontend_bundle(monkeypatch, tmp_path):
    import runpy
    from pathlib import Path

    source = Path(__file__).resolve().parents[1] / "app.py"
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.chdir(tmp_path)
    deployed = TestClient(runpy.run_path(str(source))["app"])
    for path in [
        "/data/ip2region_v4.xdb",
        "/data/places.json",
        "/data/ranges.sqlite",
        "/.env.local",
        "/missing",
    ]:
        assert deployed.get(path).status_code == 404
    assert deployed.get("/api/health").status_code == 200


def test_washington_state_is_not_the_district_of_columbia():
    point = lookup("195.211.97.37")["location"]
    assert point["level"] == "region"
    assert -125 < point["longitude"] < -116
    assert 45 < point["latitude"] < 50
    west, south, east, north = point["bounds"]
    assert west < point["longitude"] < east
    assert south < point["latitude"] < north


def test_region_names_prefer_canonical_names_and_reject_equal_aliases():
    from scripts.prepare_data import region_index

    def feature(name, alias, identifier):
        return {
            "properties": {
                "name": name,
                "name_en": alias,
                "iso_a2": "US",
                "adm1_code": identifier,
                "longitude": 0.5,
                "latitude": 0.5,
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
            },
        }

    state = feature("Washington", "Shared", "state")
    district = feature("District of Columbia", "Washington", "district")
    other = feature("Other", "Shared", "other")
    for features in ([state, district, other], [other, district, state]):
        regions, _, _ = region_index(features)
        assert regions[("US", "washington")]["region_id"] == "state"
        assert regions[("US", "districtofcolumbia")]["region_id"] == "district"
        assert ("US", "shared") not in regions


@pytest.mark.parametrize("area", ["country:US", "region:USA-3519", "country:CN"])
@pytest.mark.parametrize("version", [4, 6])
def test_reverse_ranges_match_forward_lookup_and_exact_cidrs(area, version):
    from ipaddress import ip_address, ip_network

    response = client.get("/api/ranges", params={"area": area, "version": version})
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 20
    assert data["total_ranges"] >= 20
    assert isinstance(data["address_count"], str)
    assert len(response.content) < 40000
    assert response.headers["cache-control"].startswith("public")
    for item in data["items"]:
        first, last = ip_address(item["start"]), ip_address(item["end"])
        assert first.version == last.version == version
        cursor = int(first)
        for cidr in item["cidrs"]:
            network = ip_network(cidr)
            assert int(network.network_address) == cursor
            cursor += network.num_addresses
        assert cursor == int(last) + 1
        assert int(item["address_count"]) == int(last) - int(first) + 1
        for address in (first, last):
            forward = lookup(str(address))
            assert forward["scope"] == "public"
            assert forward["country_code"] == data["area"]["country_code"]
            assert forward["region"] == item["region"]
            assert forward["city"] == item["city"]
            assert forward["isp"] == item["isp"]
    second = client.get(
        "/api/ranges", params={"area": area, "version": version, "after": data["next_cursor"]}
    ).json()
    assert second["total_ranges"] == data["total_ranges"]
    assert all(item["id"] > data["next_cursor"] for item in second["items"])
    assert not ({x["id"] for x in data["items"]} & {x["id"] for x in second["items"]})


def test_reverse_area_catalog_empty_results_and_bad_requests():
    countries = client.get("/api/areas").json()["items"]
    assert any(a["id"] == "country:US" for a in countries)
    states = client.get("/api/areas?country=US").json()["items"]
    assert any(a["name"] == "Washington" for a in states)
    assert any(a["name"] == "District of Columbia" for a in states)
    for params in (
        {"area": "country:US", "version": 5},
        {"area": "country:US", "after": -1},
        {"area": "country:US", "after": 2**64},
        {"area": "' OR 1=1"},
    ):
        assert client.get("/api/ranges", params=params).status_code == 422
    assert client.get("/api/ranges?area=region:nonexistent").status_code == 404
    assert client.get("/api/areas?country=ZZ").status_code == 404
    assert client.get("/api/ranges?area=country:US&after=9223372036854775807").json()["items"] == []


def test_reverse_index_is_readonly_and_queries_use_an_index():
    import sqlite3

    from plotip.ranges import connect

    with connect() as db:
        with pytest.raises(sqlite3.OperationalError):
            db.execute("DELETE FROM ranges")
        for field in ("country", "region"):
            plan = db.execute(
                f"EXPLAIN QUERY PLAN SELECT * FROM ranges WHERE {field}=? AND version=? AND id>? ORDER BY id LIMIT 21",
                (1, 4, 0),
            ).fetchall()
            assert any(f"USING INDEX ranges_{field}" in row[3] for row in plan)
