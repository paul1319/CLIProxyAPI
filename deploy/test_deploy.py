"""Exercise deployment failure boundaries without a Docker daemon or real secrets."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


SOURCE = Path(__file__).resolve().parent
FAKE_TOOL = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ["FAKE_ROOT"])
path = root / "state.json"
state = json.loads(path.read_text())
args = sys.argv[1:]
tool = pathlib.Path(sys.argv[0]).name
image = os.environ.get("CLI_PROXY_IMAGE", "")
with (root / "calls.jsonl").open("a") as log:
    log.write(json.dumps([tool, args, image, os.environ.get("DOCKER_CONFIG", "")]) + "\n")
scenario = os.environ.get("SCENARIO", "")
if tool == "curl":
    sys.exit(1 if scenario == "unhealthy" and state.get("image") == "sha256:new" else 0)
if args[0] == "info": sys.exit(0)
if args[0] == "context": print("unix:///fake/docker.sock"); sys.exit(0)
if args[0] == "login":
    assert sys.stdin.read() == "temporary-token"
    config = pathlib.Path(os.environ["DOCKER_CONFIG"]) / "config.json"
    # Docker discovers a native credential helper when no auth configuration exists.
    if not config.exists() or not json.loads(config.read_text()).get("auths"):
        print("Native credential helper is unavailable", file=sys.stderr)
        sys.exit(1)
    if scenario == "login-fails": sys.exit(1)
    config.write_text("temporary credentials")
    sys.exit(0)
if args[0] == "pull": sys.exit(1 if scenario == "pull-fails" else 0)
if args[:2] == ["image", "inspect"]:
    print(("linux/amd64" if scenario == "wrong-arch" else "linux/arm64") if "Architecture" in args[3] else "sha256:new")
    sys.exit(0)
if args[0] == "inspect":
    print("true " + state["image"] if "State.Running" in args[2] else state["image"])
    sys.exit(0)
if args[0] == "compose":
    if "config" in args: sys.exit(0)
    if "ps" in args:
        if state.get("exists"): print("container")
        sys.exit(0)
    if "up" in args:
        state.update(exists=True, image="sha256:old" if image == "sha256:old" else "sha256:new")
        path.write_text(json.dumps(state))
        sys.exit(1 if scenario == "up-fails" and image != "sha256:old" else 0)
    if "rm" in args:
        state["exists"] = False
        path.write_text(json.dumps(state))
        sys.exit(0)
raise RuntimeError(args)
'''


class DeployTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.runtime = self.root / "runtime with spaces"
        self.release = self.runtime / "releases/new"
        self.release.mkdir(parents=True)
        self.previous = self.runtime / "releases/old"
        self.previous.mkdir()
        for name in ("config", "auths", "logs", "plugins", "static"):
            (self.runtime / name).mkdir()
        (self.runtime / "config/config.yaml").write_text("config-version: 8\n")
        for name in ("compose.yaml", "deploy.sh"):
            shutil.copyfile(SOURCE / name, self.release / name)
        (self.previous / "compose.yaml").write_text("# previous Compose bundle\n")
        self.saved = self.runtime / ".env"
        self.saved.write_text("CLI_PROXY_IMAGE=old:version\nCLI_PROXY_RELEASE=old\n")
        self.state_path = self.root / "state.json"
        self.state_path.write_text(json.dumps({"exists": True, "image": "sha256:old"}))
        binaries = self.root / "bin"
        binaries.mkdir()
        for name in ("docker", "curl"):
            tool = binaries / name
            tool.write_text(FAKE_TOOL.replace("/usr/bin/env python3", sys.executable))
            tool.chmod(0o700)
        self.env = dict(os.environ, PATH=str(binaries) + os.pathsep + os.environ["PATH"],
                        FAKE_ROOT=str(self.root), CLI_PROXY_DEPLOY_DIR=str(self.runtime),
                        CLI_PROXY_HEALTH_TIMEOUT="0")

    def run_deploy(self, scenario="", args=(), token=None):
        env = dict(self.env, SCENARIO=scenario)
        result = subprocess.run(["bash", str(self.release / "deploy.sh"), "registry/image:new", *args],
                                env=env, input=token, text=True, capture_output=True)
        calls = self.root / "calls.jsonl"
        self.calls = [json.loads(line) for line in calls.read_text().splitlines()] if calls.exists() else []
        return result

    def state(self):
        return json.loads(self.state_path.read_text())

    def test_success_commits_state_and_releases_lock(self):
        result = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("CLI_PROXY_RELEASE=new", self.saved.read_text())
        self.assertEqual(self.state()["image"], "sha256:new")
        self.assertFalse((self.runtime / ".deploy.lock").exists())

    def test_upgrade_creates_persistent_quota_state_without_overwriting_snapshots(self):
        result = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        directory = self.runtime / "state"
        self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
        snapshot = directory / "quota-snapshots.json"
        snapshot.write_text('{"version":1,"records":{}}')
        result = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(snapshot.read_text(), '{"version":1,"records":{}}')

    def test_pull_failure_preserves_running_service(self):
        before = self.saved.read_bytes()
        result = self.run_deploy("pull-fails")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.state()["image"], "sha256:old")
        self.assertEqual(self.saved.read_bytes(), before)
        self.assertFalse(any("up" in call[1] for call in self.calls))

    def test_wrong_architecture_does_not_replace_service(self):
        result = self.run_deploy("wrong-arch")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.state()["image"], "sha256:old")

    def test_health_failure_restores_image_and_original_compose_bundle(self):
        result = self.run_deploy("unhealthy")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.state()["image"], "sha256:old")
        self.assertIn("CLI_PROXY_IMAGE=sha256:old", self.saved.read_text())
        updates = [call for call in self.calls if "up" in call[1]]
        self.assertEqual(len(updates), 2)
        self.assertIn(str(self.previous / "compose.yaml"), updates[-1][1])

    def test_partial_compose_failure_also_rolls_back(self):
        result = self.run_deploy("up-fails")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.state()["image"], "sha256:old")

    def test_failed_first_deployment_preserves_data_and_removes_service(self):
        self.state_path.write_text(json.dumps({"exists": False}))
        self.saved.unlink()
        result = self.run_deploy("unhealthy")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.state()["exists"])
        self.assertTrue((self.runtime / "config/config.yaml").exists())
        self.assertFalse(self.saved.exists())

    def test_existing_lock_prevents_any_docker_operations(self):
        (self.runtime / ".deploy.lock").mkdir()
        result = self.run_deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.calls, [])

    def test_registry_token_uses_disposable_credentials(self):
        result = self.run_deploy(args=("--registry-token-stdin", "owner"), token="temporary-token")
        self.assertEqual(result.returncode, 0, result.stderr)
        login = next(call for call in self.calls if call[1][0] == "login")
        self.assertFalse(Path(login[3]).exists())
        self.assertNotIn("temporary-token", result.stdout + result.stderr)

    def test_registry_login_failure_preserves_service_and_cleans_credentials(self):
        before = self.saved.read_bytes()
        result = self.run_deploy("login-fails", args=("--registry-token-stdin", "owner"), token="temporary-token")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.state()["image"], "sha256:old")
        self.assertEqual(self.saved.read_bytes(), before)
        self.assertFalse(any("up" in call[1] for call in self.calls))
        login = next(call for call in self.calls if call[1][0] == "login")
        self.assertFalse(Path(login[3]).exists())
        self.assertFalse((self.runtime / ".deploy.lock").exists())


class SSHConfirmationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        tool = self.root / "tailscale"
        tool.write_text("#!" + sys.executable + "\n" + r'''
import os, pathlib, sys
pathlib.Path(os.environ["SSH_INPUT"]).write_text(sys.stdin.read())
print(os.environ.get("SSH_OUTPUT", ""), end="")
sys.exit(int(os.environ.get("SSH_STATUS", "0")))
''')
        tool.chmod(0o700)
        self.receipt = "Deployed registry/image:new (bundle new); HTTP health check passed."

    def run_ssh(self, output, status=0):
        env = dict(os.environ, PATH=str(self.root) + os.pathsep + os.environ["PATH"],
                   SSH_INPUT=str(self.root / "input"), SSH_OUTPUT=output, SSH_STATUS=str(status))
        return subprocess.run(["bash", str(SOURCE / "ssh-confirm.sh"), self.receipt, "pavel@mac", "deploy"],
                              env=env, input="temporary-token", text=True, capture_output=True)

    def test_confirmed_completion_preserves_stdin_without_logging_it(self):
        result = self.run_ssh("progress\n" + self.receipt + "\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / "input").read_text(), "temporary-token")
        self.assertNotIn("temporary-token", result.stdout + result.stderr)

    def test_missing_receipt_fails_even_when_ssh_reports_success(self):
        for output in ("", "Keychain Error\n", "prefix " + self.receipt + "\n"):
            with self.subTest(output=output):
                result = self.run_ssh(output)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("did not confirm completion", result.stderr)

    def test_transport_failure_is_not_hidden_by_a_receipt(self):
        result = self.run_ssh(self.receipt + "\n", status=255)
        self.assertNotEqual(result.returncode, 0)


class BootstrapTest(unittest.TestCase):
    def test_bootstrap_preserves_configuration_and_does_not_print_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = Path(directory) / "runtime"
            command = [sys.executable, str(SOURCE / "bootstrap.py"), "--directory", str(runtime)]
            first = subprocess.run(command, capture_output=True, text=True, check=True)
            credentials = json.loads((runtime / "initial-credentials.json").read_text())
            for value in credentials.values():
                self.assertGreaterEqual(len(value), 32)
                self.assertNotIn(value, first.stdout + first.stderr)
            self.assertEqual((runtime / "initial-credentials.json").stat().st_mode & 0o777, 0o600)
            config = runtime / "config/config.yaml"
            config.write_text("# user configuration\n")
            subprocess.run(command, capture_output=True, text=True, check=True)
            self.assertEqual(config.read_text(), "# user configuration\n")


if __name__ == "__main__":
    unittest.main()
