from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse

from fastapi import HTTPException

from app.config import settings

SKIP_DIRS = {
    "node_modules",
    "dist",
    "build",
    ".git",
    "coverage",
    ".next",
    ".venv",
    "venv",
    "__pycache__",
    ".turbo",
}
SECRET_SUFFIXES = {".pem", ".key", ".p12", ".pfx"}


def scan_roots() -> list[Path]:
    raw = settings.scan_roots.strip()
    if not raw:
        return []
    roots: list[Path] = []
    for part in raw.split(os.pathsep):
        if not part.strip():
            continue
        roots.append(Path(part).expanduser().resolve())
    return roots


def is_secret(path: Path) -> bool:
    name = path.name.lower()
    if name.startswith(".env") or name in {"id_rsa", "id_dsa", "credentials.json", "secrets.json"}:
        return True
    return path.suffix.lower() in SECRET_SUFFIXES


def resolve_repository(raw: str) -> Path:
    roots = scan_roots()
    if not roots:
        raise HTTPException(status_code=422, detail="Set PULSEOPS_SCAN_ROOTS before registering a repository")
    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        raise HTTPException(status_code=422, detail="Repository path must be absolute")
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as exc:
        raise HTTPException(status_code=422, detail="Repository path is not a directory") from exc
    if not resolved.is_dir():
        raise HTTPException(status_code=422, detail="Repository path is not a directory")
    for root in roots:
        try:
            resolved.relative_to(root)
        except ValueError:
            continue
        else:
            return resolved
    raise HTTPException(status_code=422, detail="Repository path is outside the allowed scan roots")


def inside(root: Path, candidate: Path) -> Path | None:
    try:
        resolved = candidate.resolve()
        resolved.relative_to(root.resolve())
    except (OSError, ValueError):
        return None
    return resolved


def clean_routes(routes: list[str]) -> list[str]:
    cleaned: list[str] = []
    for route in routes:
        value = route.strip().split("?", 1)[0].split("#", 1)[0]
        if not value:
            continue
        if not value.startswith("/") or "\\" in value or ".." in Path(value).parts:
            raise HTTPException(status_code=422, detail="Routes must be absolute paths on the target app")
        if value not in cleaned:
            cleaned.append(value)
    if not cleaned:
        raise HTTPException(status_code=422, detail="Add at least one route")
    return cleaned


def clean_base_url(raw: str | None) -> str | None:
    if raw is None or not raw.strip():
        return None
    parsed = urlparse(raw.strip())
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in {"http", "https"} or host not in {"localhost", "127.0.0.1", "::1"}:
        raise HTTPException(status_code=422, detail="Base URL must be http://localhost or http://127.0.0.1")
    return raw.strip().rstrip("/")
