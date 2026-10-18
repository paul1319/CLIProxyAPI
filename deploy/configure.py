#!/usr/bin/env python3
"""Apply versioned runtime settings through the management API from CI."""

import argparse
import json
from pathlib import Path
import sys
import urllib.error
import urllib.request


class ConfigurationError(RuntimeError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def contains_settings(actual, expected):
    if isinstance(expected, dict):
        return isinstance(actual, dict) and all(
            key in actual and contains_settings(actual[key], value)
            for key, value in expected.items()
        )
    return type(actual) is type(expected) and actual == expected


def apply_config(runtime, settings, base_url="http://127.0.0.1:8317"):
    if not isinstance(settings, dict) or not settings:
        raise ConfigurationError("Runtime settings must be a non-empty JSON object")
    credentials = json.loads((runtime / "initial-credentials.json").read_text())
    key = credentials["management_key"]
    # The key stays on the Mac. Neither proxies nor redirects may forward it.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def request(method, path="", data=None, etag=None):
        headers = {"Authorization": "Bearer " + key}
        if data is not None:
            headers["Content-Type"] = "application/yaml" if path == ".yaml" else "application/json"
        if etag:
            headers["If-Match"] = etag
        req = urllib.request.Request(base_url + "/v8/management/config" + path,
                                     data=data, headers=headers, method=method)
        try:
            with opener.open(req, timeout=15) as response:
                return response.read(), response.headers.get("ETag")
        except urllib.error.HTTPError as err:
            # Error bodies can include configuration or credentials; never log them.
            raise ConfigurationError(f"Management API {method} returned HTTP {err.code}") from None
        except (OSError, urllib.error.URLError):
            raise ConfigurationError(f"Management API {method} did not confirm completion") from None

    current, current_etag = request("GET")
    if contains_settings(json.loads(current), settings):
        print("Runtime configuration already matches; verification passed.")
        return
    if not current_etag:
        raise ConfigurationError("Management API omitted the configuration ETag; refusing to write")
    snapshot, snapshot_etag = request("GET", ".yaml")
    if snapshot_etag != current_etag:
        raise ConfigurationError("Configuration changed while preparing the update; rerun CI")
    _, applied_etag = request("PATCH", data=json.dumps(settings).encode(), etag=current_etag)
    if not applied_etag:
        raise ConfigurationError("Update returned no ETag; configuration may have changed, verify before retrying")
    try:
        saved, _ = request("GET")
        if not contains_settings(json.loads(saved), settings):
            raise ConfigurationError("Saved runtime configuration does not match the requested settings")
    except (ConfigurationError, ValueError):
        try:
            request("PUT", ".yaml", snapshot, applied_etag)
        except ConfigurationError:
            raise ConfigurationError("Verification failed and rollback was not confirmed; inspect configuration") from None
        raise ConfigurationError("Verification failed; previous configuration restored") from None
    print("Runtime configuration applied; verification passed.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path.home() / ".local/share/cliproxyapi")
    args = parser.parse_args()
    try:
        settings = json.loads(Path(__file__).with_name("runtime-config.json").read_text())
        apply_config(args.directory.expanduser(), settings)
    except (ConfigurationError, OSError, ValueError, KeyError) as error:
        # Avoid traceback/source excerpts or parser messages containing secret values.
        print(str(error) if isinstance(error, ConfigurationError) else "Cannot read runtime settings or local management credentials", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
