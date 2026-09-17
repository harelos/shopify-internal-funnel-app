#!/usr/bin/env python3
"""Shared CJ authentication with on-disk token caching.

CJ rate-limits getAccessToken to roughly one call per 300 seconds and explicitly
recommends caching. Every CJ caller in this repo should import get_token() from
here rather than authenticating on its own.

The cache file holds a bearer token and is gitignored. Nothing here prints a
secret.
"""

from __future__ import annotations

import json
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

APP_DIR = Path(__file__).resolve().parent
ENV_PATH = APP_DIR / ".env"
TOKEN_CACHE_PATH = APP_DIR / ".cj_token_cache.json"
CJ_BASE = "https://developers.cjdropshipping.com/api2.0/v1"

# Refresh a little before real expiry so a long batch cannot expire mid-run.
EXPIRY_SAFETY_MARGIN_SECONDS = 600


def load_env_file(path: Path = ENV_PATH) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env_file()


def _build_ssl_context() -> ssl.SSLContext:
    """Verified TLS using certifi's bundle.

    The Windows system trust store still carries the expired DST Root CA X3
    cross-sign, so the default context picks that dead path for Shopify's
    Let's Encrypt chain and fails with 'certificate has expired'. certifi
    validates the live ISRG Root X1 path. Verification stays ON — never
    fall back to CERT_NONE, which would silently accept a MITM.
    """
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


SSL_CTX = _build_ssl_context()


def _parse_cj_time(value: str) -> float:
    """CJ returns naive UTC strings like '2026-09-15T10:22:33+08:00' or plain."""
    if not value:
        return 0.0
    text = value.strip().replace("Z", "+00:00")
    for fmt in (None, "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            parsed = datetime.fromisoformat(text) if fmt is None else datetime.strptime(text, fmt)
        except ValueError:
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()
    return 0.0


def request_json(
    method: str,
    url: str,
    headers: dict[str, str],
    payload: Any | None = None,
    timeout: int = 60,
) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, context=SSL_CTX, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            raise RuntimeError(f"HTTP {exc.code} from {urllib.parse.urlsplit(url).path}: {body[:300]}") from None


def _read_cache() -> dict[str, Any]:
    if not TOKEN_CACHE_PATH.exists():
        return {}
    try:
        return json.loads(TOKEN_CACHE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _write_cache(cache: dict[str, Any]) -> None:
    TOKEN_CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        os.chmod(TOKEN_CACHE_PATH, 0o600)
    except OSError:
        pass


def _authenticate(api_key: str) -> dict[str, Any]:
    response = request_json(
        "POST",
        f"{CJ_BASE}/authentication/getAccessToken",
        {"Content-Type": "application/json"},
        {"apiKey": api_key},
    )
    data = response.get("data") or {}
    token = data.get("accessToken")
    if not token:
        raise RuntimeError(
            f"CJ authentication failed: code={response.get('code')} message={response.get('message')}"
        )
    expiry = _parse_cj_time(str(data.get("accessTokenExpiryDate") or "")) or (time.time() + 14 * 86400)
    return {
        "accessToken": token,
        "refreshToken": data.get("refreshToken"),
        "expires_at": expiry,
        "obtained_at": time.time(),
    }


def get_token(force_refresh: bool = False) -> str:
    """Return a valid CJ access token, authenticating only when necessary."""
    api_key = os.getenv("CJ_API_KEY")
    if not api_key:
        raise SystemExit("Missing CJ_API_KEY in app/.env")

    cache = _read_cache()
    cached = cache.get("token") or {}
    same_key = cache.get("api_key_fingerprint") == api_key[-6:]
    fresh = float(cached.get("expires_at") or 0) - EXPIRY_SAFETY_MARGIN_SECONDS > time.time()
    if not force_refresh and same_key and fresh and cached.get("accessToken"):
        return str(cached["accessToken"])

    # CJ rejects a second getAccessToken inside its 300s window; surface that clearly.
    last_attempt = float(cache.get("last_auth_attempt") or 0)
    wait = 300 - (time.time() - last_attempt)
    if wait > 0 and cached.get("accessToken") and not force_refresh:
        return str(cached["accessToken"])
    if wait > 0:
        raise RuntimeError(f"CJ getAccessToken is rate limited; retry in {int(wait)}s")

    cache["last_auth_attempt"] = time.time()
    _write_cache(cache)
    token_record = _authenticate(api_key)
    cache["token"] = token_record
    cache["api_key_fingerprint"] = api_key[-6:]
    _write_cache(cache)
    return str(token_record["accessToken"])


def cj_request(
    method: str,
    endpoint: str,
    payload: Any | None = None,
    params: dict[str, Any] | None = None,
    token: str | None = None,
) -> dict[str, Any]:
    url = f"{CJ_BASE}/{endpoint}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    headers = {"CJ-Access-Token": token or get_token(), "Content-Type": "application/json"}
    return request_json(method, url, headers, payload)
