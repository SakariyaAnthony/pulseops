import struct
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.config import settings
from app.scan.paths import default_scan_root, is_secret, resolve_repository
from app.scan.report import summarize
from app.scan.static import _png_chunk, image_size, inventory, parse_references
from app.scan.stats import median, normalize_endpoint, observation_record, percentile


def test_percentiles_hide_small_samples():
    assert median([40, 10, 30]) == 30
    assert percentile([10, 20, 30, 40], 95) is None
    assert percentile([10, 20, 30, 40, 50], 95) == 50
    assert percentile([float(item) for item in range(19)], 99) is None
    assert percentile([], 50) is None


def test_endpoint_normalization_drops_ids_and_keeps_words():
    assert normalize_endpoint("/api/users/123/orders") == "/api/users/{id}/orders"
    assert normalize_endpoint("/api/users/123e4567-e89b-12d3-a456-426614174000") == "/api/users/{id}"
    assert normalize_endpoint("/health") == "/health"


def test_observations_do_not_keep_headers():
    record = observation_record(
        route="/",
        method="get",
        url_path="/api/users/9?token=secret",
        status_code=None,
        duration_ms=12,
        transfer_bytes=None,
        failure_type="timeout",
        resource_type="fetch",
    )
    assert record["endpoint_template"] == "/api/users/{id}"
    assert record["failure_type"] == "timeout"
    assert "authorization" not in record
    assert "token" not in record["endpoint_template"]


def test_unset_scan_roots_use_the_home_directory(monkeypatch: pytest.MonkeyPatch):
    settings.scan_roots = ""
    monkeypatch.delenv("SUDO_USER", raising=False)
    assert default_scan_root() == Path.home().resolve()


def test_repository_path_must_stay_inside_allowed_roots(tmp_path: Path):
    allowed = tmp_path / "allowed"
    outside = tmp_path / "outside"
    allowed.mkdir()
    outside.mkdir()
    settings.scan_roots = str(allowed)
    assert resolve_repository(str(allowed)) == allowed.resolve()
    with pytest.raises(HTTPException):
        resolve_repository(str(outside))
    with pytest.raises(HTTPException):
        resolve_repository(str(allowed / ".." / "outside"))


def test_static_scan_skips_secrets_and_marks_dynamic_references(tmp_path: Path):
    source = tmp_path / "src"
    source.mkdir()
    (source / "App.tsx").write_text(
        'import logo from "./logo.svg";\n'
        "const name = 'x';\n"
        "const dynamic = `/assets/${name}.png`;\n"
        'export function App(){ return <img src="./gone.png" alt="" />; }\n',
        encoding="utf-8",
    )
    (source / "logo.svg").write_bytes(b"<svg></svg>")
    (source / "unused.png").write_bytes(b"same")
    (source / "copy.png").write_bytes(b"same")
    hidden = tmp_path / "node_modules"
    hidden.mkdir()
    (hidden / "hidden.png").write_bytes(b"nope")
    (tmp_path / ".env").write_text("TOKEN=1\n", encoding="utf-8")
    files = {item["file_path"] for item in inventory(tmp_path)}
    assert files == {"src/logo.svg", "src/unused.png", "src/copy.png"}
    assert is_secret(tmp_path / ".env")
    references, uncertain = parse_references(tmp_path)
    kinds = {(item["reference"], item["kind"]) for item in references}
    assert ("./logo.svg", "file") in kinds
    assert ("./gone.png", "missing") in kinds
    assert uncertain[0]["reason"] == "dynamic reference"
    assert "node_modules/hidden.png" not in files


def test_image_signals_python_references_and_dimensions(tmp_path: Path):
    icons = tmp_path / "src" / "icons"
    icons.mkdir(parents=True)
    (icons / "mark.svg").write_bytes(b"<svg></svg>")
    png = tmp_path / "src" / "photo.png"
    ihdr = struct.pack(">IIBBBBB", 40, 20, 8, 2, 0, 0, 0)
    png.write_bytes(b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", ihdr))
    (tmp_path / "src" / "App.tsx").write_text(
        'export function App(){ return <img src="./photo.png" alt="" />; }\n',
        encoding="utf-8",
    )
    (tmp_path / "src" / "note.py").write_text('ASSET = "./photo.png"\n', encoding="utf-8")
    assert image_size(png) == (40, 20)
    files = {item["file_path"]: item for item in inventory(tmp_path)}
    assert files["src/icons/mark.svg"]["asset_type"] == "icon"
    assert files["src/photo.png"]["width"] == 40
    references, _uncertain = parse_references(tmp_path)
    photo = [item for item in references if item["target"] == "src/photo.png"]
    assert any(item["source_file"] == "src/note.py" for item in photo)
    signal = next(item["signals"] for item in photo if item["signals"])
    assert signal["img"] is True
    assert signal["has_srcset"] is False
    assert signal["loading"] is None
    summary = summarize(
        [
            {
                "file_path": "src/photo.png",
                "asset_type": "image",
                "classification": "referenced_and_observed",
                "file_size_bytes": 250_000,
                "transfer_bytes": 1800,
                "duration_ms": 30,
                "failure_type": "timeout",
                "duplicate_of": None,
                "references": ["src/App.tsx"],
                "routes": ["/"],
                "signals": signal,
            }
        ]
    )
    assert summary["load_performance"][0]["failure_type"] == "timeout"
    assert any("srcset" in note for note in summary["optimization"][0]["notes"])
    assert any("200 KB" in note for note in summary["optimization"][0]["notes"])
    assert summary["lazy_loading"][0]["file_path"] == "src/photo.png"


def _asset(path, kind="image", **extra):
    base = {
        "file_path": path,
        "asset_type": kind,
        "classification": "referenced_and_observed",
        "file_size_bytes": None,
        "transfer_bytes": None,
        "duration_ms": None,
        "failure_type": None,
        "duplicate_of": None,
        "content_hash": None,
        "references": [],
        "routes": [],
        "signals": {},
    }
    base.update(extra)
    return base


def test_insights_flag_large_low_quality_failed_and_unused_assets():
    summary = summarize(
        [
            _asset("src/hero.png", file_size_bytes=1_500_000, signals={"width": 3000, "height": 2000}),
            _asset("src/banner.jpg", file_size_bytes=250_000, signals={"width": 2000, "height": 1000}),
            _asset("src/crushed.jpg", file_size_bytes=30_000, signals={"width": 1200, "height": 800}),
            _asset("src/tiny.png", file_size_bytes=900, signals={"width": 64, "height": 48}),
            _asset("src/intro.mp4", "video", file_size_bytes=6_000_000),
            _asset("src/clip.mp4", "video", file_size_bytes=1_500_000),
            _asset("src/small.png", file_size_bytes=50_000, signals={"width": 800, "height": 600}),
            _asset(
                "src/gone.png",
                classification="observed_without_source_match",
                failure_type="http_error",
                routes=["/shop"],
                signals={"status_code": 404, "runtime_only": True, "asset_type": "image"},
            ),
            _asset("src/old.png", classification="potentially_unused", file_size_bytes=40_000),
            _asset("src/a.png", file_size_bytes=10, content_hash="x", duplicate_of="src/b.png"),
            _asset("src/b.png", file_size_bytes=10, content_hash="x", duplicate_of="src/a.png"),
            _asset("src/missing.png", classification="missing_reference", references=["src/App.tsx"]),
        ]
    )
    insights = summary["insights"]
    assert insights["total_assets"] == 11
    assert insights["by_type"]["video"]["count"] == 2
    large = {row["file_path"]: row for row in insights["large"]}
    assert set(large) == {"src/hero.png", "src/banner.jpg", "src/intro.mp4", "src/clip.mp4"}
    assert large["src/hero.png"]["severity"] == "high"
    assert large["src/banner.jpg"]["severity"] == "medium"
    assert large["src/intro.mp4"]["severity"] == "high"
    assert large["src/clip.mp4"]["severity"] == "medium"
    assert insights["large"][0]["file_path"] == "src/intro.mp4"
    quality = {row["file_path"]: row["kinds"] for row in insights["quality"]}
    assert quality["src/tiny.png"] == ["low_resolution"]
    assert quality["src/crushed.jpg"] == ["heavy_compression"]
    assert quality["src/hero.png"] == ["oversized"]
    assert "src/small.png" not in quality
    assert [row["file_path"] for row in insights["failed"]] == ["src/gone.png"]
    assert insights["failed"][0]["status_code"] == 404
    assert "404" in insights["failed"][0]["notes"][0]
    assert insights["failed"][0]["in_repository"] is False
    assert [row["file_path"] for row in insights["unused"]] == ["src/old.png"]
    assert insights["unused_bytes"] == 40_000
    assert insights["duplicate_bytes"] == 10
    assert [row["file_path"] for row in insights["missing"]] == ["src/missing.png"]
    assert summary["potentially_unused"] == 1
    assert summary["missing_reference"] == 1


def test_insights_are_empty_without_assets():
    insights = summarize([])["insights"]
    assert insights["total_assets"] == 0
    assert insights["large"] == []
    assert insights["unused_bytes"] == 0


def test_scan_gate_allows_app_and_public_hosts_but_not_private_ones(monkeypatch):
    import socket

    from app.scan.browser import is_allowed_host

    answers = {
        "fakestoreapi.com": ["104.21.1.1"],
        "internal.example": ["10.0.0.5"],
        "metadata.example": ["169.254.169.254"],
        "loop.example": ["127.0.0.1"],
        "mixed.example": ["104.21.1.1", "192.168.1.9"],
    }

    def fake_getaddrinfo(host, *_args, **_kwargs):
        if host not in answers:
            raise socket.gaierror("no such host")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 0)) for address in answers[host]]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)
    decisions: dict[str, bool] = {}
    assert is_allowed_host("localhost", "localhost", decisions)
    assert is_allowed_host("", "localhost", decisions)
    assert is_allowed_host("fakestoreapi.com", "localhost", decisions)
    for blocked in ("internal.example", "metadata.example", "loop.example", "mixed.example", "unknown.example", "db.local", "127.0.0.1"):
        assert not is_allowed_host(blocked, "localhost", decisions), blocked


def test_vital_rating_follows_web_vitals_thresholds():
    from app.vitals import rate, worst

    assert rate("LCP", 2500) == "good"
    assert rate("LCP", 2501) == "needs-improvement"
    assert rate("LCP", 4001) == "poor"
    assert rate("INP", 200) == "good"
    assert rate("INP", 501) == "poor"
    assert rate("CLS", 0.1) == "good"
    assert rate("CLS", 0.26) == "poor"
    assert rate("LCP", None) is None
    assert rate("BOGUS", 1) is None
    assert worst(["good", None, "poor", "needs-improvement"]) == "poor"
    assert worst([None, None]) is None


def test_vital_route_drops_query_and_fragment():
    from app.schemas import clean_route

    assert clean_route("/orders/42?token=secret#top") == "/orders/42"
    assert clean_route("?x=1") == "/"
    assert clean_route("/plain") == "/plain"


def test_vital_percentile_is_withheld_below_the_sample_floor():
    from app.vitals import _p75

    assert _p75("LCP", 19, 3000.0, 20) is None
    assert _p75("LCP", 20, 3000.04, 20) == 3000.0
    assert _p75("CLS", 25, 0.123456, 20) == 0.1235
    assert _p75("LCP", 50, None, 20) is None


def _audit(value=None, items=None):
    audit = {"numericValue": value}
    if items is not None:
        audit["details"] = {"items": items}
    return audit


def _report(**overrides):
    audits = {
        "largest-contentful-paint": _audit(5200),
        "cumulative-layout-shift": _audit(0.31),
        "total-blocking-time": _audit(750),
        "first-contentful-paint": _audit(1500),
        "speed-index": _audit(4000),
        "server-response-time": _audit(900),
        "network-requests": _audit(
            items=[
                {"url": "http://app/hero.jpg", "resourceType": "Image", "transferSize": 1_900_000},
                {"url": "http://app/app.js", "resourceType": "Script", "transferSize": 650_000},
                {
                    "url": "http://app/api/summary",
                    "resourceType": "Fetch",
                    "transferSize": 400,
                    "networkRequestTime": 100,
                    "networkEndTime": 1100,
                },
            ]
        ),
        "long-tasks": _audit(items=[{"url": "http://app/app.js", "duration": 900, "startTime": 1000}]),
        "bootup-time": _audit(items=[{"url": "http://app/app.js", "scripting": 800}]),
        "render-blocking-resources": _audit(items=[{"url": "http://app/site.css", "wastedMs": 300}]),
    }
    audits.update(overrides)
    return {"categories": {"performance": {"score": 0.42}}, "audits": audits}


def test_lighthouse_report_is_parsed_into_a_lab_page_with_diagnosis():
    from app.scan.lighthouse import parse_report

    page = parse_report(_report(), "/", "mobile")
    assert page["metric_source"] == "lab"
    assert page["form_factor"] == "mobile"
    assert page["perf_score"] == 42
    assert page["lcp_ms"] == 5200
    assert page["inp_ms"] is None
    assert page["tbt_ms"] == 750
    assert page["resource_count"] == 3
    assert page["total_transfer_bytes"] == 1_900_000 + 650_000 + 400
    assert page["resource_summary_json"]["Image"] == {"count": 1, "bytes": 1_900_000}
    assert page["script_ms"] == 800
    ids = {item["id"] for item in page["diagnosis_json"]}
    assert {"large_image", "blocking_api", "long_js_task", "render_blocking", "layout_shift", "slow_server"} <= ids
    for item in page["diagnosis_json"]:
        assert item["evidence"] and item["action"]


def test_lighthouse_report_with_nothing_wrong_has_no_diagnosis():
    from app.scan.lighthouse import parse_report

    clean = _report(
        **{
            "largest-contentful-paint": _audit(1200),
            "cumulative-layout-shift": _audit(0.01),
            "total-blocking-time": _audit(20),
            "server-response-time": _audit(80),
            "network-requests": _audit(items=[{"url": "http://app/app.js", "resourceType": "Script", "transferSize": 40_000}]),
            "long-tasks": _audit(items=[]),
            "render-blocking-resources": _audit(items=[]),
        }
    )
    assert parse_report(clean, "/", "desktop")["diagnosis_json"] == []
