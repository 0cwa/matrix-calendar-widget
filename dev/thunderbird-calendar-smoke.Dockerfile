# Official Docker Hub library/python linux/amd64 manifest, pinned by digest.
# https://hub.docker.com/layers/library/python/3.13.17-slim-bookworm/images/sha256-4cea12ab7d78a3312c85f8cab19b6971d4fe9704da25443986c0bc20a6678850
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
        libx11-xcb1 \
        passwd \
        libxt6; \
    rm -rf /var/lib/apt/lists/*; \
    groupadd --gid "$TASK_GID" smoke; \
    useradd --uid "$TASK_UID" --gid "$TASK_GID" --home-dir /home/runner --no-create-home --shell /usr/sbin/nologin smoke; \
    mkdir -p /input /wheels /task/app /task/venv /task/workspace /home/runner; \
    chmod 0755 /input /wheels /task /task/app /task/venv /task/workspace /home/runner

ENV PYTHONNOUSERSITE=1 \
    PYTHONDONTWRITEBYTECODE=1

USER ${TASK_UID}:${TASK_GID}
WORKDIR /task
CMD ["/usr/local/bin/python3"]
