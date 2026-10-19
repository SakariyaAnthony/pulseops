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
