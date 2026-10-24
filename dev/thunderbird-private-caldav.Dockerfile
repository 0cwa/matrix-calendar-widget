# syntax=docker/dockerfile:1.7

FROM docker.io/library/python:3.13.17-slim-bookworm@sha256:4cea12ab7d78a3312c85f8cab19b6971d4fe9704da25443986c0bc20a6678850

ARG TASK_UID
ARG TASK_GID

RUN set -eux; \
    apt-get update; \
    apt-get install --yes --no-install-recommends \
        fonts-liberation \
        libasound2 \
        libdbus-glib-1-2 \
        libgtk-3-0 \
        libnss3-tools \
        libstdc++6 \
        libx11-xcb1 \
        passwd \
        libxt6; \
    rm -rf /var/lib/apt/lists/*; \
    groupadd --gid "$TASK_GID" smoke; \
    useradd --uid "$TASK_UID" --gid "$TASK_GID" --home-dir /home/runner --no-create-home --shell /usr/sbin/nologin smoke; \
    mkdir -p /input /wheels /private-wheels /task/app /task/venv /task/workspace /task/source /task/node /home/runner; \
    chmod 0755 /input /wheels /private-wheels /task /task/app /task/venv /task/workspace /task/source /task/node /home/runner

ENV PYTHONNOUSERSITE=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY --from=radicale-auth /apply_vobject_period_patch.py /tmp/apply_vobject_period_patch.py
COPY --from=radicale-auth /thunderbird-private-caldav-runtime-requirements.txt /tmp/radicale-runtime-requirements.txt

RUN set -eux; \
    /usr/local/bin/python3 -m venv /app; \
    /app/bin/python -B -m pip install --isolated --no-cache-dir --no-deps \
        --require-hashes --only-binary=:all: \
        --requirement /tmp/radicale-runtime-requirements.txt; \
    /app/bin/python -B -m pip check; \
    /app/bin/python -B /tmp/apply_vobject_period_patch.py; \
    /app/bin/python -B -c "from importlib.metadata import version; import radicale, vobject.icalendar; assert radicale.VERSION == '3.8.0'; assert version('vobject') == '0.9.9'"; \
    rm /tmp/apply_vobject_period_patch.py /tmp/radicale-runtime-requirements.txt

USER ${TASK_UID}:${TASK_GID}
WORKDIR /task
CMD ["/usr/local/bin/python3"]
