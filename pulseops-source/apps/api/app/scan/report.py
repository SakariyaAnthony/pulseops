from __future__ import annotations

LARGE_IMAGE_BYTES = 200 * 1024
IMAGE_HEAVY_BYTES = 1024 * 1024
VIDEO_LARGE_BYTES = 1024 * 1024
VIDEO_HEAVY_BYTES = 5 * 1024 * 1024
SLOW_LOAD_MS = 1000
LOW_RES_PX = 200
OVERSIZED_PX = 2400
HEAVY_COMPRESSION_BYTES_PER_PIXEL = 0.08
RASTER = (".png", ".jpg", ".jpeg", ".webp", ".avif")
LAZY_NOTE = (
    "This image was requested on a tested route and is not marked loading=lazy or fetchpriority=high. "
    "It may be the first image on the page, so check it before deferring it."
)


def summarize(assets: list[dict]) -> dict:
    counts: dict[str, int] = {}
    referenced = 0
    potentially_unused = 0
    missing_reference = 0
    total_size = 0
    total_transfer = 0
    largest: list[dict] = []
    duplicates: list[dict] = []
    optimization: list[dict] = []
    lazy_loading: list[dict] = []
    load_performance: list[dict] = []
    locations: list[dict] = []
    for asset in assets:
        asset_type = asset.get("asset_type") or "other"
        if asset.get("classification") != "missing_reference":
            counts[asset_type] = counts.get(asset_type, 0) + 1
        classification = asset.get("classification")
        if classification in {None, "referenced_and_observed", "referenced_not_observed"}:
            referenced += 1
        if classification in {"potentially_unused", "duplicate_candidate"}:
            potentially_unused += 1
        if classification == "missing_reference":
            missing_reference += 1
        size = asset.get("file_size_bytes")
        if isinstance(size, int):
            total_size += size
            largest.append({"file_path": asset["file_path"], "file_size_bytes": size})
        transfer = asset.get("transfer_bytes")
        if isinstance(transfer, int):
            total_transfer += transfer
        if asset.get("duplicate_of"):
            duplicates.append({"file_path": asset["file_path"], "duplicate_of": asset["duplicate_of"]})
        notes = _optimization_notes(asset)
        if notes:
            optimization.append({"file_path": asset["file_path"], "notes": notes})
        if _lazy_candidate(asset):
            lazy_loading.append({"file_path": asset["file_path"], "note": LAZY_NOTE})
        if asset.get("duration_ms") is not None or asset.get("transfer_bytes") is not None or asset.get("failure_type"):
            load_performance.append(
                {
                    "file_path": asset["file_path"],
                    "duration_ms": asset.get("duration_ms"),
                    "transfer_bytes": asset.get("transfer_bytes"),
                    "failure_type": asset.get("failure_type"),
                }
            )
        if asset.get("references") or asset.get("routes"):
            locations.append(
                {
                    "file_path": asset["file_path"],
                    "references": list(asset.get("references") or []),
                    "routes": list(asset.get("routes") or []),
                }
            )
    largest.sort(key=lambda item: item["file_size_bytes"], reverse=True)
    return {
        "counts": counts,
        "referenced": referenced,
        "potentially_unused": potentially_unused,
        "missing_reference": missing_reference,
        "total_size_bytes": total_size,
        "total_transfer_bytes": total_transfer,
        "largest": largest[:5],
        "duplicates": duplicates,
        "optimization": optimization,
        "lazy_loading": lazy_loading,
        "load_performance": load_performance,
        "locations": locations,
        "insights": _insights(assets),
    }


def _row(asset: dict, severity: str | None = None, notes: list[str] | None = None, kinds: list[str] | None = None) -> dict:
    signals = asset.get("signals") or {}
    return {
        "file_path": asset["file_path"],
        "asset_type": asset.get("asset_type") or "other",
        "size_bytes": asset.get("file_size_bytes"),
        "transfer_bytes": asset.get("transfer_bytes"),
        "duration_ms": asset.get("duration_ms"),
        "width": signals.get("width"),
        "height": signals.get("height"),
        "routes": list(asset.get("routes") or []),
        "references": list(asset.get("references") or []),
        "severity": severity,
        "notes": notes or [],
        "kinds": kinds or [],
        "failure_type": asset.get("failure_type"),
        "status_code": signals.get("status_code"),
        "duplicate_of": asset.get("duplicate_of"),
        "confidence": asset.get("confidence"),
        "in_repository": not signals.get("runtime_only"),
    }


def _failure_note(asset: dict) -> str:
    status = (asset.get("signals") or {}).get("status_code")
    kind = asset.get("failure_type")
    if kind == "http_error" and status:
        return f"The server answered HTTP {status}."
    if kind == "timeout":
        return "The request timed out."
    return "The request failed before a response arrived."


def _bytes(asset: dict) -> int:
    size = asset.get("file_size_bytes")
    if isinstance(size, int):
        return size
    transfer = asset.get("transfer_bytes")
    return transfer if isinstance(transfer, int) else 0


def _size_note(size: int) -> str:
    if size >= 1024 * 1024:
        return f"{size / (1024 * 1024):.1f} MB"
    return f"{size / 1024:.0f} KB"


def _large(asset: dict) -> dict | None:
    kind = asset.get("asset_type")
    size = _bytes(asset)
    if kind == "image" and size > LARGE_IMAGE_BYTES:
        heavy = size > IMAGE_HEAVY_BYTES
        note = f"{_size_note(size)}. Resize it, and try WebP or AVIF."
        return _row(asset, "high" if heavy else "medium", [note])
    if kind == "video" and size > VIDEO_LARGE_BYTES:
        heavy = size > VIDEO_HEAVY_BYTES
        note = f"{_size_note(size)}. Compress it, or load it only when needed with preload=none and a poster image."
        return _row(asset, "high" if heavy else "medium", [note])
    return None


def _quality(asset: dict) -> dict | None:
    if asset.get("asset_type") != "image":
        return None
    path = str(asset.get("file_path") or "").lower()
    if not path.endswith(RASTER):
        return None
    signals = asset.get("signals") or {}
    width, height = signals.get("width"), signals.get("height")
    if not isinstance(width, int) or not isinstance(height, int) or width <= 0 or height <= 0:
        return None
    notes: list[str] = []
    kinds: list[str] = []
    size = asset.get("file_size_bytes")
    if max(width, height) < LOW_RES_PX:
        kinds.append("low_resolution")
        notes.append(f"Low resolution ({width}×{height}px). It may look blurry if it is shown larger than this.")
    if path.endswith((".jpg", ".jpeg")) and isinstance(size, int) and width * height >= 250_000:
        per_pixel = size / (width * height)
        if per_pixel < HEAVY_COMPRESSION_BYTES_PER_PIXEL:
            kinds.append("heavy_compression")
            notes.append(f"Very heavy compression ({per_pixel:.3f} bytes per pixel). Photos may show blocky artifacts.")
    if max(width, height) > OVERSIZED_PX:
        kinds.append("oversized")
        notes.append(f"{width}×{height}px is larger than most screens show. Resize it to cut the file size.")
    if not kinds:
        return None
    return _row(asset, "high" if "heavy_compression" in kinds else "medium", notes, kinds)


def _insights(assets: list[dict]) -> dict:
    inventory = [a for a in assets if a.get("classification") != "missing_reference"]
    by_type: dict[str, dict] = {}
    for asset in inventory:
        slot = by_type.setdefault(asset.get("asset_type") or "other", {"count": 0, "size_bytes": 0, "transfer_bytes": 0})
        slot["count"] += 1
        if isinstance(asset.get("file_size_bytes"), int):
            slot["size_bytes"] += asset["file_size_bytes"]
        if isinstance(asset.get("transfer_bytes"), int):
            slot["transfer_bytes"] += asset["transfer_bytes"]

    large = [row for row in (_large(a) for a in inventory) if row]
    quality = [row for row in (_quality(a) for a in inventory) if row]
    failed = [_row(asset, "high", [_failure_note(asset)]) for asset in inventory if asset.get("failure_type")]
    slow = [
        _row(asset, "medium", [f"Took {round(asset['duration_ms'])} ms to download."])
        for asset in inventory
        if isinstance(asset.get("duration_ms"), (int, float)) and asset["duration_ms"] >= SLOW_LOAD_MS
    ]
    unused = [
        _row(asset, None, [asset.get("explanation") or ""])
        for asset in inventory
        if asset.get("classification") in {"potentially_unused", "duplicate_candidate"}
    ]
    duplicates = [_row(asset, None, [f"Same contents as {asset['duplicate_of']}."]) for asset in inventory if asset.get("duplicate_of")]
    missing = [
        _row(asset, "high", [asset.get("explanation") or ""])
        for asset in assets
        if asset.get("classification") == "missing_reference"
    ]

    groups: dict[str, list[dict]] = {}
    for asset in inventory:
        if asset.get("content_hash"):
            groups.setdefault(asset["content_hash"], []).append(asset)
    duplicate_bytes = sum(
        _bytes(members[0]) * (len(members) - 1) for members in groups.values() if len(members) > 1
    )
    unused_bytes = sum(_bytes(asset) for asset in inventory if asset.get("classification") in {"potentially_unused", "duplicate_candidate"})

    large.sort(key=lambda row: row["size_bytes"] or row["transfer_bytes"] or 0, reverse=True)
    quality.sort(key=lambda row: (row["severity"] != "high", -(row["size_bytes"] or 0)))
    failed.sort(key=lambda row: row["file_path"])
    slow.sort(key=lambda row: row["duration_ms"] or 0, reverse=True)
    unused.sort(key=lambda row: row["size_bytes"] or row["transfer_bytes"] or 0, reverse=True)
    return {
        "total_assets": len(inventory),
        "by_type": by_type,
        "unused_bytes": unused_bytes,
        "duplicate_bytes": duplicate_bytes,
        "large_bytes": sum(row["size_bytes"] or row["transfer_bytes"] or 0 for row in large),
        "large": large,
        "quality": quality,
        "failed": failed,
        "slow": slow,
        "unused": unused,
        "duplicates": duplicates,
        "missing": missing,
    }


def _optimization_notes(asset: dict) -> list[str]:
    notes: list[str] = []
    path = str(asset.get("file_path") or "").lower()
    size = asset.get("file_size_bytes")
    signals = asset.get("signals") or {}
    if asset.get("asset_type") == "image" and path.endswith((".png", ".jpg", ".jpeg")):
        notes.append("PNG or JPEG. A WebP or AVIF version may be smaller.")
    if asset.get("asset_type") == "image" and isinstance(size, int) and size > LARGE_IMAGE_BYTES:
        notes.append("Larger than 200 KB.")
    if signals.get("img") and not signals.get("has_srcset"):
        notes.append("The img tag has no srcset.")
    return notes


def _lazy_candidate(asset: dict) -> bool:
    signals = asset.get("signals") or {}
    routes = asset.get("routes") or []
    if not signals.get("img") or not routes:
        return False
    return signals.get("loading") != "lazy" and signals.get("fetchpriority") != "high"
