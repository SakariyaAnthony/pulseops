from __future__ import annotations

import ast
import hashlib
import json
import struct
import zlib
from pathlib import Path

from app.scan.paths import SKIP_DIRS, inside, is_secret

ASSET_SUFFIXES = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    ".avif",
    ".ico",
    ".mp4",
    ".webm",
    ".mp3",
    ".wav",
    ".ogg",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".eot",
    ".css",
}
SOURCE_SUFFIXES = {".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".css", ".html", ".htm"}
MAX_PARSE_BYTES = 1_000_000


def asset_type(path: Path) -> str:
    suffix = path.suffix.lower()
    folders = {part.lower() for part in path.parts}
    if suffix == ".ico" or (suffix == ".svg" and any("icon" in part for part in folders)):
        return "icon"
    if suffix in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"}:
        return "image"
    if suffix == ".svg":
        return "svg"
    if suffix in {".mp4", ".webm"}:
        return "video"
    if suffix in {".mp3", ".wav", ".ogg"}:
        return "audio"
    if suffix in {".woff", ".woff2", ".ttf", ".otf", ".eot"}:
        return "font"
    if suffix == ".css":
        return "css"
    return "other"


def looks_like_asset(value: str) -> bool:
    bare = value.split("?", 1)[0].split("#", 1)[0].strip().lower()
    return bare.endswith(tuple(ASSET_SUFFIXES))


def detect_framework(repo: Path) -> str | None:
    package = repo / "package.json"
    if not package.is_file() or is_secret(package):
        return None
    try:
        data = json.loads(package.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    deps = {}
    if isinstance(data, dict):
        for key in ("dependencies", "devDependencies"):
            block = data.get(key)
            if isinstance(block, dict):
                deps.update(block)
    if "react" in deps and "vite" in deps:
        return "react-vite"
    if "react" in deps:
        return "react"
    return None


def _hash_file(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            digest.update(chunk)
    return size, digest.hexdigest()


def inventory(repo: Path) -> list[dict]:
    found: list[dict] = []
    for path in repo.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.relative_to(repo).parts):
            continue
        if is_secret(path) or path.suffix.lower() not in ASSET_SUFFIXES:
            continue
        contained = inside(repo, path)
        if contained is None:
            continue
        size, digest = _hash_file(contained)
        width, height = image_size(contained)
        found.append(
            {
                "file_path": contained.relative_to(repo.resolve()).as_posix(),
                "asset_type": asset_type(contained),
                "file_size_bytes": size,
                "content_hash": digest,
                "width": width,
                "height": height,
            }
        )
    return sorted(found, key=lambda item: item["file_path"])


def _parsers() -> dict[str, object]:
    from tree_sitter import Language, Parser
    import tree_sitter_css
    import tree_sitter_html
    import tree_sitter_javascript
    import tree_sitter_typescript

    def build(language) -> Parser:
        return Parser(Language(language))

    javascript = build(tree_sitter_javascript.language())
    typescript = build(tree_sitter_typescript.language_typescript())
    tsx = build(tree_sitter_typescript.language_tsx())
    css = build(tree_sitter_css.language())
    html = build(tree_sitter_html.language())
    return {
        ".js": javascript,
        ".mjs": javascript,
        ".cjs": javascript,
        ".jsx": tsx,
        ".ts": typescript,
        ".tsx": tsx,
        ".css": css,
        ".html": html,
        ".htm": html,
    }


def _text(node, source: bytes) -> str:
    return source[node.start_byte : node.end_byte].decode("utf-8", "replace").strip().strip("'\"`")


def _collect(node, source: bytes, found: list[str], uncertain: list[str]) -> None:
    if node.type in {"template_string", "template_literal"}:
        text = _text(node, source)
        dynamic = "${" in text or any(child.type == "template_substitution" for child in node.children)
        if looks_like_asset(text):
            (uncertain if dynamic else found).append(text)
        return
    if node.type in {"string", "string_value", "attribute_value", "quoted_attribute_value"}:
        if any(child.type in {"string", "string_fragment"} for child in node.children) and node.type != "string":
            for child in node.children:
                _collect(child, source, found, uncertain)
            return
        text = _text(node, source)
        if looks_like_asset(text):
            parent = node.parent.type if node.parent is not None else ""
            if parent in {"binary_expression", "template_substitution"}:
                uncertain.append(text)
            else:
                found.append(text)
        return
    for child in node.children:
        _collect(child, source, found, uncertain)


def parse_references(repo: Path) -> tuple[list[dict], list[dict]]:
    parsers = _parsers()
    references: list[dict] = []
    uncertain: list[dict] = []
    root = repo.resolve()
    for path in repo.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in SOURCE_SUFFIXES:
            continue
        relative = path.relative_to(repo)
        if any(part in SKIP_DIRS for part in relative.parts) or is_secret(path):
            continue
        if path.stat().st_size > MAX_PARSE_BYTES:
            uncertain.append({"source_file": relative.as_posix(), "reference": "", "reason": "file too large to parse"})
            continue
        parser = parsers.get(path.suffix.lower())
        if parser is None:
            continue
        source = path.read_bytes()
        tree = parser.parse(source)
        found: list[str] = []
        dynamic: list[str] = []
        _collect(tree.root_node, source, found, dynamic)
        source_posix = relative.as_posix()
        image_signals = _image_signals(tree.root_node, source, root, path)
        for ref in found:
            target, kind = _resolve(root, path, ref)
            references.append(
                {
                    "source_file": source_posix,
                    "reference": ref,
                    "target": target,
                    "kind": kind,
                    "signals": image_signals.get(target or ""),
                }
            )
        for ref in dynamic:
            uncertain.append({"source_file": source_posix, "reference": ref, "reason": "dynamic reference"})
    references.extend(_python_references(repo))
    return references, uncertain


def _resolve(repo: Path, source: Path, ref: str) -> tuple[str | None, str]:
    bare = ref.split("?", 1)[0].split("#", 1)[0].strip()
    if bare.startswith(("http://", "https://", "data:", "//")):
        return None, "remote"
    if bare.startswith(("@/", "~/")) or "${" in bare:
        return None, "uncertain"
    if bare.startswith("/"):
        candidate = repo / bare.lstrip("/")
    else:
        candidate = source.parent / bare
    contained = inside(repo, candidate)
    if contained is None:
        return None, "outside"
    relative = contained.relative_to(repo).as_posix()
    if contained.is_file():
        return relative, "file"
    return relative, "missing"


def image_size(path: Path) -> tuple[int | None, int | None]:
    try:
        data = path.read_bytes()[:512_000]
    except OSError:
        return None, None
    suffix = path.suffix.lower()
    if suffix == ".png" and data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        width, height = struct.unpack(">II", data[16:24])
        return int(width), int(height)
    if suffix == ".gif" and data.startswith((b"GIF87a", b"GIF89a")) and len(data) >= 10:
        width, height = struct.unpack("<HH", data[6:10])
        return int(width), int(height)
    if suffix in {".jpg", ".jpeg"}:
        return _jpeg_size(data)
    if suffix == ".webp" and data.startswith(b"RIFF") and data[8:12] == b"WEBP" and data[12:16] == b"VP8X" and len(data) >= 30:
        return 1 + int.from_bytes(data[24:27], "little"), 1 + int.from_bytes(data[27:30], "little")
    return None, None


def _jpeg_size(data: bytes) -> tuple[int | None, int | None]:
    if not data.startswith(b"\xff\xd8"):
        return None, None
    index = 2
    while index + 9 < len(data):
        if data[index] != 0xFF:
            index += 1
            continue
        marker = data[index + 1]
        if marker in {0xC0, 0xC1, 0xC2}:
            height, width = struct.unpack(">HH", data[index + 5 : index + 9])
            return int(width), int(height)
        if marker in {0xD8, 0xD9, 0x01} or 0xD0 <= marker <= 0xD7:
            index += 2
            continue
        if index + 4 > len(data):
            break
        length = struct.unpack(">H", data[index + 2 : index + 4])[0]
        if length < 2:
            break
        index += 2 + length
    return None, None


def _image_signals(node, source: bytes, repo: Path, source_path: Path) -> dict[str, dict]:
    found: list[dict[str, str]] = []
    _walk_images(node, source, found)
    signals: dict[str, dict] = {}
    for image in found:
        target, kind = _resolve(repo, source_path, image.get("src", ""))
        if kind != "file" or not target:
            continue
        slot = signals.setdefault(target, {"img": True, "has_srcset": True, "loading": "lazy", "fetchpriority": "high"})
        slot["has_srcset"] = bool(slot["has_srcset"] and image.get("srcset"))
        loading = image.get("loading", "").strip("'\"").lower()
        if loading != "lazy":
            slot["loading"] = loading or None
        priority = image.get("fetchpriority", "").strip("'\"").lower()
        if priority != "high":
            slot["fetchpriority"] = priority or None
    return signals


def _walk_images(node, source: bytes, found: list[dict[str, str]]) -> None:
    if node.type in {"jsx_self_closing_element", "jsx_opening_element"}:
        tag = ""
        attrs: dict[str, str] = {}
        for child in node.children:
            if not tag and child.type == "identifier":
                tag = _text(child, source)
            if child.type == "jsx_attribute":
                name = ""
                value = ""
                for part in child.children:
                    if not name and part.type in {"property_identifier", "identifier"}:
                        name = _text(part, source).lower()
                    elif part.type in {"string", "jsx_expression"}:
                        value = _text(part, source)
                if name:
                    attrs[name] = value
        if tag.lower() == "img":
            found.append(attrs)
    for child in node.children:
        _walk_images(child, source, found)


def _python_references(repo: Path) -> list[dict]:
    found: list[dict] = []
    root = repo.resolve()
    for path in repo.rglob("*.py"):
        relative = path.relative_to(repo)
        if any(part in SKIP_DIRS for part in relative.parts) or is_secret(path):
            continue
        if path.stat().st_size > MAX_PARSE_BYTES:
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except (OSError, SyntaxError, UnicodeError):
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and looks_like_asset(node.value):
                target, kind = _resolve(root, path, node.value)
                found.append(
                    {
                        "source_file": relative.as_posix(),
                        "reference": node.value,
                        "target": target,
                        "kind": kind,
                        "signals": None,
                    }
                )
    return found


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
