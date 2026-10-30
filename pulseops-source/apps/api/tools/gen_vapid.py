"""Print a VAPID key pair for browser Web Push. Paste the output into apps/api/.env."""

import base64
import sys
from pathlib import Path

_vendor = Path(__file__).resolve().parents[1] / ".vendor"
if _vendor.is_dir():
    sys.path.append(str(_vendor))

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def main() -> None:
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_numbers().private_value.to_bytes(32, "big")
    public = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    print(f"PULSEOPS_VAPID_PUBLIC_KEY={_b64url(public)}")
    print(f"PULSEOPS_VAPID_PRIVATE_KEY={_b64url(private)}")


if __name__ == "__main__":
    main()
