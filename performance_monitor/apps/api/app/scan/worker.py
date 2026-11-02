from __future__ import annotations

import logging
import queue
import threading
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from app.config import settings
from app.db import SessionLocal
from app.models import ApiObservation, Asset, AssetUsage, PageResult, Project, ScanAsset, ScanRun
from app.scan.browser import collect_routes
from app.scan.lighthouse import collect_lighthouse
from app.scan.static import asset_type, detect_framework, inventory, parse_references

logger = logging.getLogger("pulseops.scan")

_queue: queue.Queue[str] = queue.Queue()
_started = False
_lock = threading.Lock()


def recover_interrupted() -> None:
    with SessionLocal() as db:
        rows = db.query(ScanRun).filter(ScanRun.status.in_(("queued", "running"))).all()
        now = datetime.now(timezone.utc)
        for row in rows:
            row.status = "failed"
            row.error_summary = "API restarted before the scan finished"
            row.completed_at = now
        db.commit()


def start_worker() -> None:
    global _started
    with _lock:
        if _started or settings.scan_inline:
            _started = True
            return
        threading.Thread(target=_loop, name="pulseops-scan", daemon=True).start()
        _started = True


def enqueue(scan_id: str) -> None:
    if settings.scan_inline:
        run_scan(scan_id)
        return
    start_worker()
    _queue.put(scan_id)


def _loop() -> None:
    while True:
        scan_id = _queue.get()
        try:
            run_scan(scan_id)
        except Exception:
            logger.exception("scan %s failed", scan_id)
            _finish(scan_id, "failed", "Scan failed")
        finally:
            _queue.task_done()


def run_scan(scan_id: str) -> None:
    if not _mark_running(scan_id):
        return
    try:
        _execute(scan_id)
    except Exception as exc:
        logger.exception("scan %s failed", scan_id)
        message = str(exc).splitlines()[0][:500] if str(exc) else "Scan failed"
        _finish(scan_id, "failed", message)


def _execute(scan_id: str) -> None:
    with SessionLocal() as db:
        scan = db.get(ScanRun, UUID(scan_id))
        project = db.get(Project, scan.project_id) if scan is not None else None
        if scan is None or project is None:
            return
        config = dict(scan.config_json or {})
        mode = scan.mode
    if mode == "vitals":
        _execute_vitals(scan_id, config)
        return
    browser_ran = mode in {"browser", "full"}
    if not _progress(scan_id, "start", "Scan started"):
        return
    files: list[dict] = []
    references: list[dict] = []
    uncertain: list[dict] = []
    observations: list[dict] = []
    seen_assets: list[dict] = []
    pages: list[dict] = []
    repo = Path(config["repository_path"]) if config.get("repository_path") else None
    if mode in {"static", "full"}:
        if repo is None:
            _finish(scan_id, "failed", "Add a repository path before a static scan")
            return
        if not _progress(scan_id, "static", "Reading assets"):
            _finish(scan_id, "cancelled", None)
            return
        files = inventory(repo)
        if not _progress(scan_id, "static", "Parsing source references"):
            _finish(scan_id, "cancelled", None)
            return
        references, uncertain = parse_references(repo)
        framework = detect_framework(repo)
        if framework:
            with SessionLocal() as db:
                project = db.get(Project, UUID(str(config["project_id"])))
                if project is not None and project.framework != framework:
                    project.framework = framework
                    db.commit()
    if browser_ran:
        if not config.get("base_url"):
            _finish(scan_id, "failed", "Add a localhost base URL before a browser scan")
            return
        if not _progress(scan_id, "browser", "Opening configured routes"):
            _finish(scan_id, "cancelled", None)
            return
        captured = collect_routes(
            config["base_url"],
            list(config.get("routes") or ["/"]),
            dict(config.get("viewport") or {}),
            int(config.get("timeout_ms") or 15000),
            lambda: _cancelled(scan_id),
        )
        pages = captured["pages"]
        observations = captured["observations"]
        seen_assets = captured["assets"]
    if _cancelled(scan_id):
        _finish(scan_id, "cancelled", None)
        return
    if not _progress(scan_id, "classify", "Classifying results"):
        _finish(scan_id, "cancelled", None)
        return
    _persist(scan_id, files, references, uncertain, pages, observations, seen_assets, browser_ran)
    route_failures = [page for page in pages if page["status"] != "ok"]
    if pages and len(route_failures) == len(pages):
        _finish(scan_id, "failed", "Every configured route failed")
        return
    if route_failures:
        _finish(scan_id, "partial", f"{len(route_failures)} route(s) failed")
        return
    _finish(scan_id, "completed", None)


def _execute_vitals(scan_id: str, config: dict) -> None:
    """Lighthouse lab audit: every route, mobile and desktop. Stored as lab data only."""
    if not config.get("base_url"):
        _finish(scan_id, "failed", "Add a localhost base URL before a Web Vitals audit")
        return
    if not _progress(scan_id, "lighthouse", "Starting Lighthouse"):
        _finish(scan_id, "cancelled", None)
        return
    pages = collect_lighthouse(
        config["base_url"],
        list(config.get("routes") or ["/"]),
        int(config.get("timeout_ms") or 15000),
        lambda: _cancelled(scan_id),
        lambda label: _progress(scan_id, "lighthouse", f"Auditing {label}"),
    )
    if _cancelled(scan_id):
        _finish(scan_id, "cancelled", None)
        return
    with SessionLocal() as db:
        scan = db.get(ScanRun, UUID(scan_id))
        if scan is None or scan.status == "cancelled":
            return
        for page in pages:
            db.add(PageResult(scan_id=scan.id, **page))
        db.commit()
    failures = [page for page in pages if page["status"] != "ok"]
    if not pages or len(failures) == len(pages):
        detail = failures[0]["error_summary"] if failures else "No routes were audited"
        _finish(scan_id, "failed", detail)
        return
    if failures:
        _finish(scan_id, "partial", f"{len(failures)} audit(s) failed")
        return
    _finish(scan_id, "completed", None)


def _persist(scan_id, files, references, uncertain, pages, observations, seen_assets, browser_ran) -> None:
    with SessionLocal() as db:
        scan = db.get(ScanRun, UUID(scan_id))
        if scan is None or scan.status == "cancelled":
            return
        project_id = scan.project_id
        by_path: dict[str, Asset] = {}
        for item in files:
            asset = (
                db.query(Asset)
                .filter(Asset.project_id == project_id, Asset.file_path == item["file_path"])
                .one_or_none()
            )
            if asset is None:
                asset = Asset(project_id=project_id, file_path=item["file_path"], asset_type=item["asset_type"])
                db.add(asset)
            asset.asset_type = item["asset_type"]
            asset.file_size_bytes = item["file_size_bytes"]
            asset.content_hash = item["content_hash"]
            db.flush()
            by_path[item["file_path"]] = asset
        names = Counter(Path(path).name for path in by_path)
        observed = _observed_paths(by_path, names, seen_assets)
        signals_by_path: dict[str, dict] = {}
        for item in files:
            signals_by_path[item["file_path"]] = {
                key: item.get(key) for key in ("width", "height") if item.get(key) is not None
            }
        referenced: dict[str, list[str]] = {}
        for ref in references:
            if ref["kind"] != "file" or not ref["target"]:
                continue
            referenced.setdefault(ref["target"], [])
            if ref["source_file"] not in referenced[ref["target"]]:
                referenced[ref["target"]].append(ref["source_file"])
            if ref.get("signals"):
                signals_by_path.setdefault(ref["target"], {}).update(ref["signals"])
            asset = by_path.get(ref["target"])
            db.add(
                AssetUsage(
                    scan_id=scan.id,
                    asset_id=asset.id if asset is not None else None,
                    source_file=ref["source_file"],
                    usage_type="reference",
                    confidence="high",
                )
            )
        for ref in references:
            if ref["kind"] != "missing":
                continue
            db.add(
                AssetUsage(
                    scan_id=scan.id,
                    source_file=ref["source_file"],
                    usage_type="missing",
                    confidence="high",
                )
            )
            db.add(
                _scan_asset(
                    scan.id,
                    ref["target"] or ref["reference"],
                    "missing_reference",
                    "A source file references this path, and that file is not in the repository.",
                    "high",
                    [ref["source_file"]],
                    [],
                )
            )
        for ref in uncertain:
            db.add(
                AssetUsage(
                    scan_id=scan.id,
                    source_file=ref.get("source_file"),
                    usage_type="uncertain",
                    confidence="low",
                )
            )
        hashes: dict[str, list[str]] = {}
        for path, asset in by_path.items():
            if asset.content_hash:
                hashes.setdefault(asset.content_hash, []).append(path)
        for path, asset in by_path.items():
            sources = referenced.get(path, [])
            routes = sorted(observed.get(path, {}).get("routes", []))
            was_observed = path in observed
            classification, explanation, confidence = _class_for(bool(sources), was_observed, browser_ran)
            twins = [item for item in hashes.get(asset.content_hash or "", []) if item != path]
            duplicate_of = twins[0] if twins else None
            if duplicate_of and classification == "potentially_unused":
                classification = "duplicate_candidate"
                explanation = f"Same contents as {duplicate_of}. {explanation}"
            elif duplicate_of:
                explanation = f"{explanation} Same contents as {duplicate_of}."
            timing = observed.get(path, {})
            if timing.get("status_code") is not None:
                signals_by_path.setdefault(path, {})["status_code"] = timing["status_code"]
            db.add(
                ScanAsset(
                    scan_id=scan.id,
                    asset_id=asset.id,
                    file_path=path,
                    classification=classification,
                    explanation=explanation,
                    confidence=confidence,
                    duplicate_of=duplicate_of,
                    references_json=sources,
                    routes_json=routes,
                    transfer_bytes=timing.get("transfer_bytes"),
                    duration_ms=timing.get("duration_ms"),
                    failure_type=timing.get("failure_type"),
                    signals_json=signals_by_path.get(path) or {},
                )
            )
        static_ran = bool(files) or bool(references)
        for path, item in sorted(_runtime_only(by_path, names, seen_assets).items()):
            kind = _runtime_asset_type(path, item["resource_type"])
            signals = {"asset_type": kind, "runtime_only": True}
            if item["status_code"] is not None:
                signals["status_code"] = item["status_code"]
            if item["resource_type"]:
                signals["resource_type"] = item["resource_type"]
            if static_ran:
                explanation = (
                    "A tested route requested this file, and it matches no file in the repository. "
                    "It may be a hosted, generated, or hashed file."
                )
            else:
                explanation = "A tested route requested this file. No repository scan was run, so there is no source comparison."
            db.add(
                ScanAsset(
                    scan_id=scan.id,
                    file_path=path,
                    classification="observed_without_source_match",
                    explanation=explanation,
                    confidence="low",
                    references_json=[],
                    routes_json=sorted(item["routes"]),
                    transfer_bytes=item["transfer_bytes"],
                    duration_ms=item["duration_ms"],
                    failure_type=item["failure_type"],
                    signals_json=signals,
                )
            )
        for page in pages:
            db.add(PageResult(scan_id=scan.id, **{key: page[key] for key in page if key != "requests"}))
        for item in observations:
            db.add(ApiObservation(scan_id=scan.id, **item))
        db.commit()


def _class_for(referenced: bool, observed: bool, browser_ran: bool) -> tuple[str | None, str, str]:
    if referenced and observed:
        return (
            "referenced_and_observed",
            "Source references this file, and a tested route requested it.",
            "high",
        )
    if referenced and browser_ran:
        return (
            "referenced_not_observed",
            "Source references this file, but the tested routes did not request it. A lazy route or conditional screen can hide a file from one browser run.",
            "low",
        )
    if referenced:
        return (None, "Referenced in source. Runtime was not checked.", "high")
    if observed:
        return (
            "observed_without_source_match",
            "A tested route requested this file, and the parser did not find a static source reference.",
            "low",
        )
    if browser_ran:
        return (
            "potentially_unused",
            "No source reference was found, and the tested routes did not request this file. That is not proof it is unused: another route, a CMS path, or a dynamic URL may still load it.",
            "low",
        )
    return (
        "potentially_unused",
        "No source reference was found. Browser routes were not run, so this is not proof the file is unused.",
        "low",
    )


def _matching_files(item: dict, by_path: dict[str, Asset], names: Counter) -> list[str]:
    url_path = item["endpoint_template"].lstrip("/")
    found: list[str] = []
    for file_path in by_path:
        base = Path(file_path).name
        path_match = url_path == file_path or url_path.endswith("/" + file_path) or file_path.endswith("/" + url_path)
        name_match = names[base] == 1 and (url_path == base or url_path.endswith("/" + base))
        if path_match or name_match:
            found.append(file_path)
    return found


_RESOURCE_TYPES = {"image": "image", "media": "video", "font": "font", "stylesheet": "css"}


def _runtime_only(by_path: dict[str, Asset], names: Counter, seen_assets: list[dict]) -> dict[str, dict]:
    """Assets a route requested that match no repository file, merged by URL path."""
    merged: dict[str, dict] = {}
    for item in seen_assets:
        if _matching_files(item, by_path, names):
            continue
        path = item["endpoint_template"].lstrip("/") or item["endpoint_template"]
        slot = merged.setdefault(
            path,
            {
                "routes": set(),
                "transfer_bytes": None,
                "duration_ms": None,
                "failure_type": None,
                "status_code": None,
                "resource_type": item.get("resource_type"),
            },
        )
        slot["routes"].add(item["route"])
        if item.get("transfer_bytes") is not None:
            slot["transfer_bytes"] = max(int(item["transfer_bytes"]), slot["transfer_bytes"] or 0)
        if item.get("duration_ms") is not None:
            slot["duration_ms"] = max(float(item["duration_ms"]), slot["duration_ms"] or 0.0)
        if item.get("failure_type") and not slot["failure_type"]:
            slot["failure_type"] = item["failure_type"]
            slot["status_code"] = item.get("status_code")
        elif slot["status_code"] is None:
            slot["status_code"] = item.get("status_code")
    return merged


def _runtime_asset_type(path: str, resource_type: str | None) -> str:
    kind = asset_type(Path(path))
    if kind == "other" and resource_type in _RESOURCE_TYPES:
        return _RESOURCE_TYPES[resource_type]
    return kind


def _observed_paths(by_path: dict[str, Asset], names: Counter, seen_assets: list[dict]) -> dict[str, dict]:
    matched: dict[str, dict] = {}
    for item in seen_assets:
        for file_path in _matching_files(item, by_path, names):
            slot = matched.setdefault(
                file_path,
                {"routes": set(), "transfer_bytes": None, "duration_ms": None, "failure_type": None, "status_code": None},
            )
            slot["routes"].add(item["route"])
            if item.get("transfer_bytes") is not None:
                slot["transfer_bytes"] = int(item["transfer_bytes"])
            if item.get("duration_ms") is not None:
                slot["duration_ms"] = float(item["duration_ms"])
            if item.get("failure_type"):
                slot["failure_type"] = item["failure_type"]
                slot["status_code"] = item.get("status_code")
    return matched


def _scan_asset(scan_id, file_path, classification, explanation, confidence, references, routes) -> ScanAsset:
    return ScanAsset(
        scan_id=scan_id,
        file_path=file_path,
        classification=classification,
        explanation=explanation,
        confidence=confidence,
        references_json=references,
        routes_json=routes,
    )


def _mark_running(scan_id: str) -> bool:
    with SessionLocal() as db:
        row = db.get(ScanRun, UUID(scan_id))
        if row is None or row.status in {"cancelled", "failed", "completed", "partial"}:
            return False
        row.status = "running"
        row.started_at = datetime.now(timezone.utc)
        row.progress = {"stage": "start", "message": "Scan started"}
        db.commit()
        return True


def _progress(scan_id: str, stage: str, message: str) -> bool:
    with SessionLocal() as db:
        row = db.get(ScanRun, UUID(scan_id))
        if row is None or row.status == "cancelled":
            return False
        row.progress = {"stage": stage, "message": message}
        db.commit()
        return True


def _cancelled(scan_id: str) -> bool:
    with SessionLocal() as db:
        row = db.get(ScanRun, UUID(scan_id))
        return row is None or row.status == "cancelled"


def _finish(scan_id: str, status: str, error: str | None) -> None:
    with SessionLocal() as db:
        row = db.get(ScanRun, UUID(scan_id))
        if row is None:
            return
        if row.status == "cancelled" and status != "cancelled":
            row.completed_at = datetime.now(timezone.utc)
            db.commit()
            return
        row.status = status
        row.error_summary = error
        row.completed_at = datetime.now(timezone.utc)
        db.commit()
