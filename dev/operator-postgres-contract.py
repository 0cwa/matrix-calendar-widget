#!/usr/bin/env python3
"""Exercise the PostgreSQL init hook with isolated, file-backed Docker secrets."""

import io
import json
import os
import selectors
import secrets
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch


IMAGE = "docker.io/library/postgres@sha256:b229dace0a197a145919c750fdb0ab5e40a7dac2c0a07afc1e7e27a65c188495"
IMAGE_ID = "sha256:79c1cb5a1a570fe5910b5839e168387dca1abcdbc20d5737cd724d9c8d8572f3"
PLATFORM = "linux/amd64"
OWNER_LABEL = "com.matrix-calendar-widget.operator-postgres-contract"
BOOTSTRAP_PATH = "/run/secrets/postgres_bootstrap_password"
APP_SECRET_PATH = "/run/secrets/matrix_calendar_pg_app_password"
INIT_PATH = "/docker-entrypoint-initdb.d/10-create-app-role.sh"
MAX_LOG_BYTES = 65536


class ContractFailure(Exception):
    pass


def require(condition, message):
    if not condition:
        raise ContractFailure(message)


def docker(*args, check=True, timeout=120):
    try:
        result = subprocess.run(
            ["docker", *map(str, args)],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise ContractFailure("A Docker operation failed.") from None
    if check and result.returncode != 0:
        raise ContractFailure("A Docker operation failed.")
    return result.returncode, result.stdout.strip()


def inspect_container(container_id):
    _, output = docker("inspect", container_id)
    return json.loads(output)[0]


def inspect_volume(volume_name):
    _, output = docker("volume", "inspect", volume_name)
    return json.loads(output)[0]


def host_secret(path, value, uid, gid):
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "w", encoding="ascii") as secret_file:
        secret_file.write(value + "\n")
    os.chmod(path, 0o400)
    if os.geteuid() == 0:
        os.chown(path, uid, gid)
    else:
        host_command(["sudo", "chown", f"{uid}:{gid}", str(path)])


def emit_secret_mask(value):
    if os.environ.get("GITHUB_ACTIONS") == "true":
        print(f"::add-mask::{value}", flush=True)


def verify_local_masking():
    values = (secrets.token_hex(32), secrets.token_hex(32))
    local_output = io.StringIO()
    with patch.dict(os.environ, {"GITHUB_ACTIONS": "false"}):
        with redirect_stdout(local_output):
            for value in values:
                emit_secret_mask(value)
    require(not local_output.getvalue(), "A local secret-mask directive was emitted.")

    actions_output = io.StringIO()
    with patch.dict(os.environ, {"GITHUB_ACTIONS": "true"}):
        with redirect_stdout(actions_output):
            for value in values:
                emit_secret_mask(value)
    expected = "".join(f"::add-mask::{value}\n" for value in values)
    require(actions_output.getvalue() == expected, "GitHub Actions did not receive the synthetic secret-mask directives.")


def verify_bounded_log_read():
    class StalledProcess:
        def __init__(self):
            read_fd, self.write_fd = os.pipe()
            self.stdout = os.fdopen(read_fd, "rb", buffering=0)
            self.returncode = None
            self.killed = False

        def poll(self):
            return self.returncode

        def kill(self):
            self.killed = True
            self.returncode = -9
            os.close(self.write_fd)

        def wait(self, timeout=None):
            if self.returncode is None:
                raise subprocess.TimeoutExpired("docker logs", timeout)
            return self.returncode

    process = StalledProcess()
    with patch("subprocess.Popen", return_value=process):
        try:
            read_logs("contract-stalled-log", secrets.token_hex(32), secrets.token_hex(32), timeout=0.02)
        except ContractFailure as error:
            require(str(error) == "PostgreSQL logs could not be scanned safely.", "A stalled log stream exposed unexpected diagnostics.")
        else:
            raise ContractFailure("A stalled PostgreSQL log stream did not time out.")
    require(process.killed, "A stalled PostgreSQL log process was not terminated.")


def create_secrets(temp_root):
    secret_dir = tempfile.mkdtemp(prefix="mcal-operator-pg-secrets-", dir=temp_root)
    try:
        os.chmod(secret_dir, 0o700)
        bootstrap, app = secrets.token_hex(32), secrets.token_hex(32)
        emit_secret_mask(bootstrap)
        emit_secret_mask(app)
        host_secret(Path(secret_dir) / "bootstrap", bootstrap, 0, 0)
        host_secret(Path(secret_dir) / "app", app, 70, 70)
        require(stat.S_IMODE(os.stat(secret_dir).st_mode) == 0o700, "Secret parent directory mode was unexpected.")
        require((os.stat(secret_dir).st_uid, os.stat(secret_dir).st_gid) == (os.getuid(), os.getgid()), "Secret parent ownership was unexpected.")
        for name, owner in (("bootstrap", (0, 0)), ("app", (70, 70))):
            info = os.stat(Path(secret_dir) / name)
            require((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (*owner, 0o400), "Secret file ownership or mode was unexpected.")
        return secret_dir, bootstrap, app
    except Exception:
        shutil.rmtree(secret_dir, ignore_errors=True)
        raise


def host_command(args):
    try:
        result = subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        raise ContractFailure("Could not set PostgreSQL secret-file ownership.") from None
    require(result.returncode == 0, "Could not set PostgreSQL secret-file ownership.")


def read_logs(container_id, bootstrap_password, app_password, expected=None, timeout=10):
    process = None
    selector = None
    try:
        process = subprocess.Popen(
            ["docker", "logs", container_id],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        deadline = time.monotonic() + timeout
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        output = bytearray()
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not selector.select(remaining):
                raise ContractFailure("PostgreSQL logs could not be scanned safely.")
            try:
                chunk = os.read(process.stdout.fileno(), min(8192, MAX_LOG_BYTES + 1 - len(output)))
            except BlockingIOError:
                continue
            if not chunk:
                break
            output.extend(chunk)
            if len(output) > MAX_LOG_BYTES:
                raise ContractFailure("PostgreSQL logs exceeded the in-memory scan limit.")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ContractFailure("PostgreSQL logs could not be scanned safely.")
        try:
            result = process.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            raise ContractFailure("PostgreSQL logs could not be scanned safely.") from None
        require(result == 0, "PostgreSQL logs could not be scanned safely.")
    except (OSError, subprocess.TimeoutExpired):
        if process is not None and process.poll() is None:
            process.kill()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass
        raise ContractFailure("PostgreSQL logs could not be scanned safely.") from None
    except ContractFailure:
        if process is not None and process.poll() is None:
            process.kill()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass
        raise
    finally:
        if selector is not None:
            selector.close()
        if process is not None and process.stdout is not None:
            process.stdout.close()
    text = output.decode("utf-8", errors="replace")
    require(bootstrap_password not in text and app_password not in text, "A synthetic PostgreSQL secret appeared in logs.")
    if expected:
        require(expected in text, "Missing app secret did not produce the fixed fail-closed diagnostic.")


def make_volume(name, project):
    docker(
        "volume", "create", "--name", name,
        "--label", f"{OWNER_LABEL}={project}",
        "--label", f"com.docker.compose.project={project}",
        "--label", f"com.docker.compose.volume={name}",
    )


def create_tracked_volume(volumes, name, project):
    volumes.append(name)
    make_volume(name, project)


def make_container(name, volume, service, project, root, with_app_secret):
    repo_root = Path(__file__).resolve().parents[1]
    args = [
        "create", "--platform", PLATFORM, "--name", name,
        "--label", f"{OWNER_LABEL}={project}",
        "--label", f"com.docker.compose.project={project}",
        "--label", f"com.docker.compose.service={service}",
        "--network", "none",
        "--mount", f"type=volume,source={volume},target=/var/lib/postgresql/data",
        "--mount", f"type=bind,source={root / 'bootstrap'},target={BOOTSTRAP_PATH},readonly",
        "--mount", f"type=bind,source={repo_root / 'deploy/postgres/10-create-app-role.sh'},target={INIT_PATH},readonly",
    ]
    if with_app_secret:
        args += ["--mount", f"type=bind,source={root / 'app'},target={APP_SECRET_PATH},readonly"]
    args += [
        "--env", "POSTGRES_USER=matrix_calendar_bootstrap",
        "--env", "POSTGRES_DB=postgres",
        "--env", f"POSTGRES_PASSWORD_FILE={BOOTSTRAP_PATH}",
        "--env", f"MATRIX_CALENDAR_PG_APP_PASSWORD_FILE={APP_SECRET_PATH}",
        "--health-cmd", "pg_isready --host=127.0.0.1 --username=matrix_calendar_bootstrap --dbname=postgres",
        "--health-interval", "1s", "--health-timeout", "3s",
        "--health-retries", "30", "--health-start-period", "2s", IMAGE,
    ]
    _, container_id = docker(*args)
    return container_id


def create_tracked_container(containers, name, volume, service, project, root, with_app_secret):
    containers.append((name, service))
    return make_container(name, volume, service, project, root, with_app_secret)


def assert_container_shape(container_id, project, service, volume, bootstrap_password, app_password, with_app_secret):
    info = inspect_container(container_id)
    labels = info["Config"].get("Labels") or {}
    require(labels.get(OWNER_LABEL) == project, "PostgreSQL container ownership label was unexpected.")
    require(labels.get("com.docker.compose.project") == project, "PostgreSQL project label was unexpected.")
    require(labels.get("com.docker.compose.service") == service, "PostgreSQL service label was unexpected.")
    environment = info["Config"].get("Env") or []
    require(
        f"POSTGRES_PASSWORD_FILE={BOOTSTRAP_PATH}" in environment
        and f"MATRIX_CALENDAR_PG_APP_PASSWORD_FILE={APP_SECRET_PATH}" in environment,
        "The bootstrap and app secret file paths are missing or not distinct.",
    )
    require(
        not any(
            value in entry
            for entry in environment
            for value in (bootstrap_password, app_password, "POSTGRES_PASSWORD=", "MATRIX_CALENDAR_PG_APP_PASSWORD=")
        ),
        "A PostgreSQL password value was persisted in Docker container configuration.",
    )
    mounts = {mount["Destination"]: mount for mount in info.get("Mounts", [])}
    require(mounts.get(BOOTSTRAP_PATH, {}).get("RW") is False, "Bootstrap secret mount is not read-only.")
    require(mounts.get(INIT_PATH, {}).get("RW") is False, "PostgreSQL init script mount is not read-only.")
    if with_app_secret:
        require(mounts.get(APP_SECRET_PATH, {}).get("RW") is False, "App secret mount is not read-only.")
    else:
        require(APP_SECRET_PATH not in mounts, "Missing-secret case unexpectedly mounts the app secret.")
    data_mount = mounts.get("/var/lib/postgresql/data", {})
    require(data_mount.get("Type") == "volume" and data_mount.get("Name") == volume, "PostgreSQL did not use its exact named data volume.")
    require(
        [(mount["Destination"], mount["Name"]) for mount in mounts.values() if mount.get("Type") == "volume"]
        == [("/var/lib/postgresql/data", volume)],
        "PostgreSQL has an unexpected or anonymous volume mount.",
    )
    require(info["HostConfig"].get("NetworkMode") == "none", "PostgreSQL is not isolated on network none.")
    require(info["HostConfig"].get("PortBindings") in (None, {}, []), "PostgreSQL unexpectedly publishes a port.")


def wait_healthy(container_id, bootstrap_password, app_password):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        state = inspect_container(container_id)["State"]
        if state["Status"] == "exited":
            read_logs(container_id, bootstrap_password, app_password)
            raise ContractFailure("PostgreSQL exited before TCP health became ready.")
        if state["Status"] == "running" and state.get("Health", {}).get("Status") == "healthy":
            return
        time.sleep(0.5)
    read_logs(container_id, bootstrap_password, app_password)
    raise ContractFailure("PostgreSQL did not become TCP healthy after initialization.")


APP_DB_SCRIPT = r"""set -eu
test -r /run/secrets/matrix_calendar_pg_app_password
test "$(stat -c '%u:%g:%a' /run/secrets/matrix_calendar_pg_app_password)" = '70:70:400'
app_password=$(cat /run/secrets/matrix_calendar_pg_app_password)
identity=$(PGPASSWORD="$app_password" psql -X -q -A -t --host=127.0.0.1 --port=5432 \
  --username=matrix_calendar_app --dbname=matrix_calendar -v ON_ERROR_STOP=1 \
  --command="SELECT current_user || '|' || (SELECT (datdba = (SELECT oid FROM pg_roles WHERE rolname = current_user))::text FROM pg_database WHERE datname = current_database()) || '|' || (SELECT (rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit)::text FROM pg_roles WHERE rolname = current_user) || '|' || (SELECT count(*)::text FROM pg_database WHERE datdba = (SELECT oid FROM pg_roles WHERE rolname = current_user))")
[ "$identity" = 'matrix_calendar_app|true|true|1' ]
PGPASSWORD="$app_password" psql -X -q --host=127.0.0.1 --port=5432 \
  --username=matrix_calendar_app --dbname=matrix_calendar -v ON_ERROR_STOP=1 \
  --command='CREATE SCHEMA matrix_calendar; CREATE TABLE matrix_calendar.contract_probe(value integer NOT NULL); INSERT INTO matrix_calendar.contract_probe VALUES (70);' >/dev/null
row=$(PGPASSWORD="$app_password" psql -X -q -A -t --host=127.0.0.1 --port=5432 \
  --username=matrix_calendar_app --dbname=matrix_calendar -v ON_ERROR_STOP=1 \
  --command='SELECT value FROM matrix_calendar.contract_probe')
[ "$row" = '70' ]
unset app_password
"""


def verify_app_database(container_id):
    docker("exec", "--user", "70:70", container_id, "sh", "-eu", "-c", APP_DB_SCRIPT)


def wait_missing_secret(container_id, bootstrap_password, app_password):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        state = inspect_container(container_id)["State"]
        if state["Status"] == "exited":
            require(state["ExitCode"] != 0, "PostgreSQL accepted initialization without the app secret.")
            read_logs(container_id, bootstrap_password, app_password, "PostgreSQL app-role secret file is unavailable.")
            return
        require(state["Status"] == "running", "The missing-secret container left its expected startup state.")
        result, _ = docker(
            "exec", "--user", "70:70", container_id, "pg_isready",
            "--host=127.0.0.1", "--username=matrix_calendar_bootstrap", "--dbname=postgres",
            check=False, timeout=10,
        )
        require(result != 0, "PostgreSQL accepted TCP connections before rejecting the missing app secret.")
        time.sleep(0.5)
    read_logs(container_id, bootstrap_password, app_password)
    raise ContractFailure("PostgreSQL did not fail promptly when its app secret was missing.")


def cleanup(project, containers, volumes, secret_dir):
    errors = []
    for container_name, service in reversed(containers):
        try:
            status, output = docker("inspect", container_name, check=False)
            if status != 0:
                continue
            info = json.loads(output)[0]
            require(info.get("Name") == f"/{container_name}", "A contract container name did not match its expected name.")
            labels = info["Config"].get("Labels") or {}
            if (
                labels.get(OWNER_LABEL) != project
                or labels.get("com.docker.compose.project") != project
                or labels.get("com.docker.compose.service") != service
            ):
                errors.append("A contract container did not have its expected ownership labels.")
                continue
            container_id = info["Id"]
            if info["State"]["Status"] == "running":
                docker("stop", "--time", "5", container_id)
            docker("rm", container_id)
        except (ContractFailure, KeyError, IndexError, json.JSONDecodeError):
            errors.append("An exact owned PostgreSQL container could not be removed.")
    for volume_name in reversed(volumes):
        try:
            status, output = docker("volume", "inspect", volume_name, check=False)
            if status != 0:
                continue
            info = json.loads(output)[0]
            labels = info.get("Labels") or {}
            require(
                info.get("Name") == volume_name
                and
                labels.get(OWNER_LABEL) == project
                and labels.get("com.docker.compose.project") == project
                and labels.get("com.docker.compose.volume") == volume_name,
                "A contract volume did not have its expected ownership labels.",
            )
            docker("volume", "rm", volume_name)
        except (ContractFailure, KeyError, IndexError, json.JSONDecodeError):
            errors.append("An exact owned PostgreSQL volume could not be removed.")
    if secret_dir:
        shutil.rmtree(secret_dir, ignore_errors=True)
        if Path(secret_dir).exists():
            errors.append("The ephemeral secret directory could not be removed.")
    try:
        containers_left = docker("ps", "-aq", "--filter", f"label={OWNER_LABEL}={project}")[1]
        volumes_left = docker("volume", "ls", "-q", "--filter", f"label={OWNER_LABEL}={project}")[1]
        require(not containers_left and not volumes_left, "Owned resources remained after cleanup.")
        for container_name, _ in containers:
            require(docker("container", "inspect", container_name, check=False)[0] != 0, "An exact contract container remained after cleanup.")
        for name in volumes:
            require(docker("volume", "inspect", name, check=False)[0] != 0, "An exact contract volume remained after cleanup.")
    except ContractFailure:
        errors.append("The contract project cleanup baseline could not be verified.")
    return errors


def verify_ambiguous_create_cleanup():
    project = "mcal-contract-cleanup-probe"
    container_name = f"{project}-positive"
    volume_name = f"{container_name}-data"
    container_id = "sha256:" + "a" * 64

    def exercise(foreign):
        # Model a daemon-side create that succeeded before the client lost its response.
        state = {"container": True, "volume": True}
        calls = []
        container_labels = {
            OWNER_LABEL: "foreign" if foreign else project,
            "com.docker.compose.project": project,
            "com.docker.compose.service": container_name,
        }
        volume_labels = {
            OWNER_LABEL: "foreign" if foreign else project,
            "com.docker.compose.project": project,
            "com.docker.compose.volume": volume_name,
        }

        def respond(status, output="", check=True):
            if status and check:
                raise ContractFailure("A stubbed Docker operation failed.")
            return status, output

        def fake_docker(*args, check=True, timeout=120):
            command = tuple(map(str, args))
            calls.append(command)
            if command in (("inspect", container_name), ("container", "inspect", container_name)):
                if not state["container"]:
                    return respond(1, check=check)
                return respond(0, json.dumps([{
                    "Id": container_id,
                    "Name": f"/{container_name}",
                    "Config": {"Labels": container_labels},
                    "State": {"Status": "running"},
                }]), check)
            if command == ("stop", "--time", "5", container_id):
                return respond(0, check=check)
            if command == ("rm", container_id):
                state["container"] = False
                return respond(0, check=check)
            if command == ("volume", "inspect", volume_name):
                if not state["volume"]:
                    return respond(1, check=check)
                return respond(0, json.dumps([{"Name": volume_name, "Labels": volume_labels}]), check)
            if command == ("volume", "rm", volume_name):
                state["volume"] = False
                return respond(0, check=check)
            if command == ("ps", "-aq", "--filter", f"label={OWNER_LABEL}={project}"):
                return respond(0, container_id if state["container"] and not foreign else "", check)
            if command == ("volume", "ls", "-q", "--filter", f"label={OWNER_LABEL}={project}"):
                return respond(0, volume_name if state["volume"] and not foreign else "", check)
            raise ContractFailure("The cleanup test received an unexpected Docker operation.")

        tracked_containers, tracked_volumes = [], []
        with patch(f"{__name__}.make_volume", side_effect=ContractFailure("The create response was lost.")):
            try:
                create_tracked_volume(tracked_volumes, volume_name, project)
            except ContractFailure:
                pass
            else:
                raise ContractFailure("The volume create stub did not lose its response.")
        with patch(f"{__name__}.make_container", side_effect=ContractFailure("The create response was lost.")):
            try:
                create_tracked_container(
                    tracked_containers, container_name, volume_name, container_name,
                    project, Path("/unused"), True,
                )
            except ContractFailure:
                pass
            else:
                raise ContractFailure("The container create stub did not lose its response.")
        require(tracked_volumes == [volume_name], "A possibly created volume was not registered before the create request.")
        require(tracked_containers == [(container_name, container_name)], "A possibly created container was not registered before the create request.")

        original_docker = globals()["docker"]
        globals()["docker"] = fake_docker
        try:
            errors = cleanup(project, tracked_containers, tracked_volumes, None)
        finally:
            globals()["docker"] = original_docker
        return errors, calls

    errors, calls = exercise(False)
    require(not errors, "Cleanup failed to recover resources created before an ambiguous Docker response.")
    require(("rm", container_id) in calls and ("volume", "rm", volume_name) in calls, "Cleanup did not remove exact owned resources by ID and name.")

    errors, calls = exercise(True)
    require(errors, "Cleanup accepted foreign resources using the contract's exact names.")
    require(("rm", container_id) not in calls and ("volume", "rm", volume_name) not in calls, "Cleanup removed a foreign resource.")


def main():
    verify_local_masking()
    verify_ambiguous_create_cleanup()
    require(shutil.which("docker") is not None, "The PostgreSQL contract requires Docker.")
    docker("info")
    run_id = os.environ.get("GITHUB_RUN_ID", "local")
    attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "1")
    project = f"mcal-op-pg-{run_id}-{attempt}-{os.getpid()}"
    owner_filter = f"label={OWNER_LABEL}={project}"
    positive_name, negative_name = f"{project}-positive", f"{project}-missing-secret"
    positive_volume, negative_volume = f"{project}-positive-data", f"{project}-missing-secret-data"
    require(not docker("ps", "-aq", "--filter", owner_filter)[1], "The isolated contract project is not empty.")
    require(not docker("volume", "ls", "-q", "--filter", owner_filter)[1], "The isolated contract project is not empty.")
    for name in (positive_name, negative_name):
        require(docker("container", "inspect", name, check=False)[0] != 0, "An exact contract container already exists.")
    for name in (positive_volume, negative_volume):
        require(docker("volume", "inspect", name, check=False)[0] != 0, "An exact contract volume already exists.")

    docker("pull", "--platform", PLATFORM, IMAGE, timeout=180)
    require(docker("image", "inspect", "--format", "{{.Id}}", IMAGE)[1] == IMAGE_ID, "The pinned PostgreSQL image ID was unexpected.")

    temp_root = os.environ.get("RUNNER_TEMP", tempfile.gettempdir())
    secret_dir, bootstrap_password, app_password = create_secrets(temp_root)

    containers, volumes = [], []
    try:
        create_tracked_volume(volumes, positive_volume, project)
        positive_id = create_tracked_container(
            containers, positive_name, positive_volume, positive_name,
            project, Path(secret_dir), True,
        )
        assert_container_shape(positive_id, project, positive_name, positive_volume, bootstrap_password, app_password, True)
        docker("start", positive_id)
        wait_healthy(positive_id, bootstrap_password, app_password)
        verify_app_database(positive_id)
        read_logs(positive_id, bootstrap_password, app_password)

        create_tracked_volume(volumes, negative_volume, project)
        negative_id = create_tracked_container(
            containers, negative_name, negative_volume, negative_name,
            project, Path(secret_dir), False,
        )
        assert_container_shape(negative_id, project, negative_name, negative_volume, bootstrap_password, app_password, False)
        docker("start", negative_id)
        wait_missing_secret(negative_id, bootstrap_password, app_password)
        print("PostgreSQL file-secret bootstrap contract passed.")
    finally:
        cleanup_errors = cleanup(project, containers, volumes, secret_dir)
        if cleanup_errors:
            raise ContractFailure(cleanup_errors[0])


if __name__ == "__main__":
    try:
        main()
    except ContractFailure as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print("The PostgreSQL contract failed without exposing diagnostic output.", file=sys.stderr)
        sys.exit(1)
