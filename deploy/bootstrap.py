#!/usr/bin/env python3
"""Initialize persistent runtime state without exposing generated credentials."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path.home() / ".local/share/cliproxyapi")
    parser.add_argument("--image", help="Start an already-built local linux/arm64 image")
    args = parser.parse_args()
    os.umask(0o077)
    runtime = args.directory.expanduser().resolve()
    for name in ("", "config", "auths", "logs", "plugins", "static", "state", "releases"):
        (runtime / name).mkdir(mode=0o700, parents=True, exist_ok=True)
    config_path = runtime / "config/config.yaml"
    if not config_path.exists():
        credentials = {"api_key": secrets.token_urlsafe(32), "management_key": secrets.token_urlsafe(32)}
        # A JSON document is valid YAML. The server can subsequently save it as YAML.
        config = {
            "config-version": 8,
            "server": {"host": "0.0.0.0", "port": 8317},
            "management": {"allow-remote": True, "secret-key": credentials["management_key"]},
            "access": {"api-keys": [credentials["api_key"]]},
            "oauth": {"auth-dir": "/root/.cli-proxy-api"},
            "routing": {"strategy": "round-robin"},
        }
        # Preserve the initial management password before startup hashes it in config.
        with (runtime / "initial-credentials.json").open("x") as target:
            json.dump(credentials, target, indent=2)
            target.write("\n")
        with config_path.open("x") as target:
            json.dump(config, target, indent=2)
            target.write("\n")
    source = Path(__file__).resolve().parent
    files = ("compose.yaml", "deploy.sh")
    checksum = hashlib.sha256(b"".join((source / name).read_bytes() for name in files)).hexdigest()[:16]
    bundle = runtime / "releases" / ("bootstrap-" + checksum)
    bundle.mkdir(mode=0o700, exist_ok=True)
    for name in files:
        destination = bundle / name
        if destination.exists():
            if destination.read_bytes() != (source / name).read_bytes():
                raise RuntimeError("Existing bootstrap bundle has changed: " + str(destination))
        else:
            shutil.copyfile(source / name, destination)
    print("Runtime directory: " + str(runtime))
    print("Initial credentials (local file only): " + str(runtime / "initial-credentials.json"))
    if args.image:
        env = dict(os.environ, CLI_PROXY_DEPLOY_DIR=str(runtime))
        subprocess.run(["/bin/bash", str(bundle / "deploy.sh"), args.image, "--local-image"], env=env, check=True)


if __name__ == "__main__":
    main()
