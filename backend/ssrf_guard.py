import contextlib
import ipaddress
import socket
from urllib.parse import urlparse

import requests

ALLOWED_SCHEMES = {"http", "https"}


class SSRFError(ValueError):
    pass


def _is_blocked_ip(ip_str):
    ip = ipaddress.ip_address(ip_str)
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def resolve_safe_ip(hostname):
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise SSRFError(f"DNS resolution failed for {hostname!r}") from exc

    resolved_ips = list(dict.fromkeys(info[4][0] for info in infos))  # de-dup, keep order
    if not resolved_ips:
        raise SSRFError(f"no addresses resolved for {hostname!r}")

    safe_ips = [ip for ip in resolved_ips if not _is_blocked_ip(ip)]
    if not safe_ips:
        raise SSRFError(f"{hostname!r} resolves only to disallowed addresses")

    # Prefer IPv4: many serverless runtimes (Vercel's Python functions
    # included) have flaky or absent IPv6 egress, so pinning to an IPv6
    # address that happened to come first would fail to connect even
    # though the same hostname resolves and connects fine via normal
    # (unpinned) DNS, which prefers IPv4 by default on most resolvers.
    ipv4_ips = [ip for ip in safe_ips if ":" not in ip]
    return ipv4_ips[0] if ipv4_ips else safe_ips[0]


def validate_fetch_url(url):
    parsed = urlparse(url)
    if parsed.scheme not in ALLOWED_SCHEMES:
        raise SSRFError("only http/https URLs are allowed")
    if not parsed.hostname:
        raise SSRFError("URL has no hostname")
    if parsed.username or parsed.password:
        raise SSRFError("userinfo in URL is not allowed")
    safe_ip = resolve_safe_ip(parsed.hostname)
    return parsed, safe_ip


@contextlib.contextmanager
def _pinned_dns(hostname, ip):
    # Re-checks at connect time would be vulnerable to DNS rebinding: the
    # hostname could resolve to a different (private) IP between our
    # validation above and the TCP connect requests performs internally.
    # Pin the single connect() lookup for this hostname to the IP we already
    # validated. Relies on the process handling one request at a time
    # (true for sync WSGI workers); safe to run gunicorn with sync workers.
    original_getaddrinfo = socket.getaddrinfo

    def patched(host, *args, **kwargs):
        if host == hostname:
            host = ip
        return original_getaddrinfo(host, *args, **kwargs)

    socket.getaddrinfo = patched
    try:
        yield
    finally:
        socket.getaddrinfo = original_getaddrinfo


def safe_get(url, headers=None, timeout=10, stream=True):
    parsed, safe_ip = validate_fetch_url(url)
    with _pinned_dns(parsed.hostname, safe_ip):
        return requests.get(url, headers=headers, timeout=timeout, stream=stream, allow_redirects=False)
