# syntax=docker/dockerfile:1.7

FROM ghcr.io/kozea/radicale:3.8.0@sha256:0d60d544710bda0fa83bfdea685db731b6cbf74e12d7f22b4997e9cff3a50468 AS radicale-runtime

USER root
COPY --from=radicale-auth /apply_vobject_period_patch.py /tmp/apply_vobject_period_patch.py
RUN /app/bin/python /tmp/apply_vobject_period_patch.py \
    && rm /tmp/apply_vobject_period_patch.py

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

COPY --from=radicale-runtime /app /app

ENV PYTHONNOUSERSITE=1 \
    PYTHONDONTWRITEBYTECODE=1

USER ${TASK_UID}:${TASK_GID}
WORKDIR /task
CMD ["/usr/local/bin/python3"]
