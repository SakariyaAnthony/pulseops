from __future__ import annotations

LARGE_IMAGE_BYTES = 200 * 1024
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
        if classification == "potentially_unused":
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
