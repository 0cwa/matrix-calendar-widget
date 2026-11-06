#!/usr/bin/env python3
"""Host-side server release transaction. Input is a private JSON request.

The operator stages the verified image before invoking this runner. This module
never receives Matrix or CalDAV credentials and does not create backups.
"""

import copy
import hashlib
import fcntl
import json
import os
import re
import signal
import struct
import subprocess
import sys
import tarfile
import tempfile


def fail(message):
    raise RuntimeError(message)


def run(argv, timeout=120):
    process = subprocess.Popen(
        argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True
    )
    try:
        stdout, _ = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.communicate()
        fail("command timed out")
    if process.returncode:
        fail("command failed")
    return stdout.decode("utf-8").strip()


def hash_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def check_saved_image_tags(path, expected):
    # Docker load may update every tag contained in an archive. Restrict it to
    # the candidate so loading cannot silently invalidate the rollback tag.
    with tarfile.open(path, "r:") as archive:
        members = archive.getmembers()
        manifests = [member for member in members if member.name == "manifest.json"]
        if (
            len(manifests) != 1
            or not manifests[0].isfile()
            or manifests[0].size > 65536
        ):
            fail("invalid image archive manifest")
        source = archive.extractfile(manifests[0])
        if source is None:
            fail("invalid image archive manifest")
        manifest = json.load(source)
        if (
            not isinstance(manifest, list)
            or len(manifest) != 1
            or manifest[0].get("RepoTags") != [expected]
        ):
            fail("unexpected image archive tags")
        repositories = [member for member in members if member.name == "repositories"]
        if len(repositories) > 1:
            fail("duplicate image repositories")
        if repositories:
            item = repositories[0]
            if not item.isfile() or item.size > 65536:
                fail("invalid image repositories")
            source = archive.extractfile(item)
            if source is None:
                fail("invalid image repositories")
            entries = json.load(source)
            repository, tag = expected.rsplit(":", 1)
            if (
                not isinstance(entries, dict)
                or set(entries) != {repository}
                or not isinstance(entries[repository], dict)
                or set(entries[repository]) != {tag}
            ):
                fail("unexpected image repositories")


def atomic_replace(path, data, expected):
    if hash_file(path) != expected:
        fail("configuration changed")
    info = os.stat(path, follow_symlinks=False)
    if not os.path.isfile(path) or os.path.islink(path):
        fail("invalid configuration")
    fd, temp = tempfile.mkstemp(prefix=".calendar-release-", dir=os.path.dirname(path))
    try:
        os.fchmod(fd, info.st_mode & 0o7777)
        os.fchown(fd, info.st_uid, info.st_gid)
        with os.fdopen(fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        if hash_file(path) != expected:
            fail("configuration changed")
        os.replace(temp, path)
        directory = os.open(os.path.dirname(path), os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def compose(config, files, args):
    command = [
        "docker",
        "compose",
        "-p",
        config["project"],
        "--project-directory",
        config["projectDirectory"],
    ]
    for file in files:
        command += ["-f", file]
    # Killing Compose mid-switch can leave daemon work running while rollback
    # starts. Let the operator reconcile an interrupted transaction instead.
    return run(command + args, timeout=None if args and args[0] == "up" else 120)


def model(config, files):
    return json.loads(compose(config, files, ["config", "--format", "json"]))


def same_except_server_image(before, after, candidate):
    before = copy.deepcopy(before)
    after = copy.deepcopy(after)
    if after["services"]["server"]["image"] != candidate:
        return False
    before["services"]["server"].pop("image")
    after["services"]["server"].pop("image")
    return before == after


def write_record(directory, data):
    destination = os.path.join(directory, "status.json")
    fd, temp = tempfile.mkstemp(prefix=".status-", dir=directory)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(data, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp, destination)
        dfd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def sibling_file(canonical, data):
    if os.path.islink(canonical) or not os.path.isfile(canonical):
        fail("invalid canonical file")
    fd, temp = tempfile.mkstemp(
        prefix=".calendar-release-", dir=os.path.dirname(canonical)
    )
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        return temp
    except Exception:
        try:
            os.close(fd)
        except OSError:
            pass
        os.unlink(temp)
        raise


def invoke_hook(path):
    if not os.path.isabs(path):
        fail("hook path must be absolute")
    run([path])


def validate(config):
    paths = (
        "canonical",
        "projectDirectory",
        "operationDirectory",
        "archive",
        "backupCheck",
        "healthCheck",
        "dependenciesCheck",
    )
    for key in paths:
        if not isinstance(config.get(key), str) or not os.path.isabs(config[key]):
            fail("invalid path")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", config.get("project", "")):
        fail("invalid project")
    if not re.fullmatch(r"[0-9a-f]{64}", config.get("archiveSha256", "")):
        fail("invalid archive hash")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", config.get("candidateId", "")):
        fail("invalid candidate image ID")
    if not re.fullmatch(
        r"matrix-calendar-widget/server:archive-[1-9][0-9]*-[1-9][0-9]*",
        config.get("candidateTag", ""),
    ):
        fail("invalid candidate tag")
    if config.get("rollbackCompatible") is not True:
        fail("rollback compatibility must be reviewed")


def service_id(config):
    ids = compose(config, [config["canonical"]], ["ps", "-q", "server"]).split()
    if len(ids) != 1:
        fail("expected one server")
    return ids[0]


def check_image(config, expected):
    actual = run(["docker", "inspect", "--format", "{{.Image}}", service_id(config)])
    if actual != expected:
        fail("running image mismatch")


def check_service_configuration(config, files):
    rendered = compose(config, files, ["config", "--hash", "server"]).split()
    if (
        len(rendered) != 2
        or rendered[0] != "server"
        or not re.fullmatch(r"[0-9a-f]{64}", rendered[1])
    ):
        fail("invalid server configuration hash")
    actual = run(
        [
            "docker",
            "inspect",
            "--format",
            '{{index .Config.Labels "com.docker.compose.config-hash"}}',
            service_id(config),
        ]
    )
    if actual != rendered[1]:
        fail("running server configuration differs")


def transaction(config):
    validate(config)
    canonical = config["canonical"]
    operation = config["operationDirectory"]
    lock = canonical + ".release.lock"
    os.mkdir(lock, 0o700)
    lock_fd = None
    try:
        lock_fd = os.open(
            os.path.join(lock, "owner"), os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600
        )
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except Exception:
        if lock_fd is not None:
            os.close(lock_fd)
            os.unlink(os.path.join(lock, "owner"))
        os.rmdir(lock)
        raise
    unlock = False
    phase = "preflight"
    activated = False
    try:
        os.mkdir(operation, 0o700)
        os.lstat(canonical)
        if os.path.islink(canonical) or not os.path.isfile(canonical):
            fail("invalid canonical file")
        with open(canonical, "rb") as source:
            original = source.read()
        original_hash = hashlib.sha256(original).hexdigest()
        baseline = model(config, [canonical])
        old_tag = baseline["services"]["server"]["image"]
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/:@-]*", old_tag):
            fail("invalid old image")
        old_id = run(["docker", "image", "inspect", "--format", "{{.Id}}", old_tag])
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", old_id):
            fail("invalid previous image ID")
        if old_tag == config["candidateTag"]:
            fail("already deployed")
        updated = original.replace(old_tag.encode(), config["candidateTag"].encode())
        if original.count(old_tag.encode()) != 1:
            fail("ambiguous canonical reference")
        updated_hash = hashlib.sha256(updated).hexdigest()
        backup = os.path.join(operation, "canonical.before")
        overlay = os.path.join(operation, "candidate.yaml")
        rollback_overlay = os.path.join(operation, "rollback.yaml")
        for path, content in (
            (backup, original),
            (
                overlay,
                (
                    "services:\n  server:\n    image: " + config["candidateTag"] + "\n"
                ).encode(),
            ),
            (
                rollback_overlay,
                ("services:\n  server:\n    image: " + old_id + "\n").encode(),
            ),
        ):
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as output:
                output.write(content)
                output.flush()
                os.fsync(output.fileno())
        record = {
            "phase": "prepared",
            "canonical": canonical,
            "project": config["project"],
            "projectDirectory": config["projectDirectory"],
            "previousTag": old_tag,
            "previousId": old_id,
            "candidateTag": config["candidateTag"],
            "candidateId": config["candidateId"],
            "originalHash": original_hash,
            "updatedHash": updated_hash,
        }
        write_record(operation, record)
        phase = "backup-check"
        invoke_hook(config["backupCheck"])
        phase = "dependency-check"
        invoke_hook(config["dependenciesCheck"])
        check_image(config, old_id)
        check_service_configuration(config, [canonical])
        phase = "image-check"
        if hash_file(config["archive"]) != config["archiveSha256"]:
            fail("transferred archive hash mismatch")
        check_saved_image_tags(config["archive"], config["candidateTag"])
        existing = run(
            [
                "docker",
                "image",
                "ls",
                "--no-trunc",
                "--filter",
                "reference=" + config["candidateTag"],
                "--format",
                "{{.ID}}",
            ]
        ).splitlines()
        if existing:
            if existing != [config["candidateId"]]:
                fail("candidate tag already points to a different image")
        else:
            run(["docker", "image", "load", "--input", config["archive"]])
        if (
            run(
                [
                    "docker",
                    "image",
                    "inspect",
                    "--format",
                    "{{.Id}}",
                    config["candidateTag"],
                ]
            )
            != config["candidateId"]
        ):
            fail("candidate image mismatch")
        if (
            run(
                [
                    "docker",
                    "image",
                    "inspect",
                    "--format",
                    "{{.Os}}/{{.Architecture}}",
                    config["candidateTag"],
                ]
            )
            != "linux/amd64"
        ):
            fail("candidate platform mismatch")
        if not same_except_server_image(
            model(config, [canonical]),
            model(config, [canonical, overlay]),
            config["candidateTag"],
        ):
            fail("unexpected compose change")
        proposed_file = sibling_file(canonical, updated)
        try:
            if not same_except_server_image(
                model(config, [canonical]),
                model(config, [proposed_file]),
                config["candidateTag"],
            ):
                fail("updated canonical does not select the candidate")
        finally:
            os.unlink(proposed_file)
        phase = "backup-check"
        invoke_hook(config["backupCheck"])
        phase = "dependency-check"
        invoke_hook(config["dependenciesCheck"])
        check_image(config, old_id)
        check_service_configuration(config, [canonical])
        if (
            run(["docker", "image", "inspect", "--format", "{{.Id}}", old_tag])
            != old_id
        ):
            fail("rollback image changed")
        if hash_file(canonical) != original_hash:
            fail("configuration changed")
        phase = "activation"
        activated = True
        try:
            compose(config, [canonical, overlay], ["up", "-d", "--no-deps", "server"])
            phase = "health"
            check_image(config, config["candidateId"])
            check_service_configuration(config, [canonical, overlay])
            invoke_hook(config["healthCheck"])
            invoke_hook(config["dependenciesCheck"])
            phase = "canonical"
            atomic_replace(canonical, updated, original_hash)
            phase = "verification"
            check_image(config, config["candidateId"])
            check_service_configuration(config, [canonical])
            if not same_except_server_image(
                baseline, model(config, [canonical]), config["candidateTag"]
            ):
                fail("canonical verification failed")
            invoke_hook(config["healthCheck"])
            invoke_hook(config["dependenciesCheck"])
            record["phase"] = "complete"
            write_record(operation, record)
            unlock = True
            return {"status": "complete"}
        except Exception:
            try:
                record["phase"] = "recovering"
                try:
                    write_record(operation, record)
                except Exception:
                    pass
                changed = hash_file(canonical) not in (original_hash, updated_hash)
                if (
                    run(["docker", "image", "inspect", "--format", "{{.Id}}", old_id])
                    != old_id
                ):
                    fail("rollback image changed")
                if changed:
                    rollback_base = sibling_file(canonical, original)
                    try:
                        if not same_except_server_image(
                            baseline,
                            model(config, [rollback_base, rollback_overlay]),
                            old_id,
                        ):
                            fail("rollback configuration changed")
                        compose(
                            config,
                            [rollback_base, rollback_overlay],
                            ["up", "-d", "--no-deps", "server"],
                        )
                    finally:
                        os.unlink(rollback_base)
                else:
                    compose(
                        config,
                        [canonical, rollback_overlay],
                        ["up", "-d", "--no-deps", "server"],
                    )
                check_image(config, old_id)
                if (
                    run(["docker", "image", "inspect", "--format", "{{.Id}}", old_tag])
                    != old_id
                ):
                    fail("previous tag changed; running image was restored")
                if changed:
                    fail("configuration changed; saved file was preserved")
                if hash_file(canonical) == updated_hash:
                    atomic_replace(canonical, original, updated_hash)
                invoke_hook(config["healthCheck"])
                invoke_hook(config["dependenciesCheck"])
                record["phase"] = "rolled-back"
                write_record(operation, record)
                unlock = True
                return {"status": "rolled-back", "phase": phase}
            except Exception:
                record["phase"] = "recovery-incomplete"
                try:
                    write_record(operation, record)
                except Exception:
                    pass
                return {"status": "recovery-incomplete", "phase": phase}
    except Exception:
        if not activated:
            if "record" in locals():
                record["phase"] = "preflight-failed"
                try:
                    write_record(operation, record)
                except Exception:
                    pass
            unlock = True
            return {"status": "failed", "phase": phase}
        raise
    finally:
        os.close(lock_fd)
        if unlock:
            os.unlink(os.path.join(lock, "owner"))
            os.rmdir(lock)


def read_exact(stream, count):
    parts = []
    while count:
        block = stream.read(min(count, 1024 * 1024))
        if not block:
            fail("incomplete input")
        parts.append(block)
        count -= len(block)
    return b"".join(parts)


def status(config):
    operation = config.get("operationDirectory")
    if not isinstance(operation, str) or not os.path.isabs(operation):
        fail("invalid operation directory")
    with open(os.path.join(operation, "status.json"), encoding="utf-8") as source:
        record = json.load(source)

    def classify(value, candidate, previous):
        return (
            "candidate"
            if value == candidate
            else "previous"
            if value == previous
            else "other"
        )

    running = "unknown"
    saved = "unknown"
    saved_resolved = "unknown"
    try:
        current = run(
            ["docker", "inspect", "--format", "{{.Image}}", service_id(record)]
        )
        running = classify(current, record["candidateId"], record["previousId"])
    except Exception:
        pass
    try:
        saved_tag = model(record, [record["canonical"]])["services"]["server"]["image"]
        saved = classify(saved_tag, record["candidateTag"], record["previousTag"])
        saved_id = run(["docker", "image", "inspect", "--format", "{{.Id}}", saved_tag])
        saved_resolved = classify(saved_id, record["candidateId"], record["previousId"])
    except Exception:
        pass

    lock = record["canonical"] + ".release.lock"
    lock_state = "absent"
    if os.path.isdir(lock):
        lock_state = "stale"
        try:
            with open(os.path.join(lock, "owner"), "rb") as owner:
                try:
                    fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    lock_state = "active"
                else:
                    fcntl.flock(owner, fcntl.LOCK_UN)
        except FileNotFoundError:
            pass
    health = "unknown"
    if (
        running != "unknown"
        and isinstance(config.get("healthCheck"), str)
        and os.path.isabs(config["healthCheck"])
    ):
        try:
            invoke_hook(config["healthCheck"])
            health = "healthy"
        except Exception:
            health = "unhealthy"
    return {
        "status": "observed",
        "phase": record["phase"],
        "lock": lock_state,
        "health": health,
        "running": running,
        "saved": saved,
        "savedResolved": saved_resolved,
    }


def main():
    stream = sys.stdin.buffer
    length = struct.unpack("!Q", read_exact(stream, 8))[0]
    if length < 1 or length > 65536:
        fail("invalid request size")
    config = json.loads(read_exact(stream, length))
    if config.get("action") == "status":
        print(json.dumps(status(config)))
        return 0
    if config.get("action") != "deploy":
        fail("invalid action")
    size = struct.unpack("!Q", read_exact(stream, 8))[0]
    if size < 1 or size > 2 * 1024 * 1024 * 1024:
        fail("invalid image size")
    stage = config.get("stageDirectory")
    if not isinstance(stage, str) or not os.path.isabs(stage):
        fail("invalid staging directory")
    operation = config.get("operationDirectory")
    if not isinstance(operation, str) or not os.path.isabs(operation):
        fail("invalid operation directory")
    stage_real = os.path.realpath(stage)
    operation_real = os.path.realpath(operation)
    common = os.path.commonpath([stage_real, operation_real])
    if common in (stage_real, operation_real):
        fail("stage and operation directories overlap")
    os.mkdir(stage, 0o700)
    archive = os.path.join(stage, "server.tar")
    fd = os.open(archive, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as output:

            def interrupted(_signal, _frame):
                raise InterruptedError("image transfer interrupted")

            previous = {
                sig: signal.signal(sig, interrupted)
                for sig in (signal.SIGHUP, signal.SIGTERM)
            }
            try:
                remaining = size
                while remaining:
                    block = stream.read(min(remaining, 1024 * 1024))
                    if not block:
                        fail("incomplete image transfer")
                    output.write(block)
                    remaining -= len(block)
            finally:
                for sig, handler in previous.items():
                    signal.signal(sig, handler)
            output.flush()
            os.fsync(output.fileno())
        config["archive"] = archive
        result = transaction(config)
    finally:
        # Only this invocation's exclusively created files are removed.
        if os.path.isfile(archive) and not os.path.islink(archive):
            os.unlink(archive)
        os.rmdir(stage)
    print(json.dumps(result))
    return 0 if result["status"] == "complete" else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        # An unexpected exception can occur after the server was switched.
        # Never report a definite failure when the outcome has not been read.
        print(json.dumps({"status": "unknown"}))
        sys.exit(1)
