FROM ghcr.io/kozea/radicale:3.8.0@sha256:0d60d544710bda0fa83bfdea685db731b6cbf74e12d7f22b4997e9cff3a50468 AS runtime-base

USER root
RUN mkdir -p /etc/radicale /data/collections \
    && chown -R radicale:radicale /etc/radicale /data

FROM runtime-base AS vobject-builder

COPY build-requirements.txt /tmp/vobject-build-requirements.txt
RUN /app/bin/python -m pip install \
    --no-cache-dir \
    --no-deps \
    --require-hashes \
    --requirement /tmp/vobject-build-requirements.txt \
    && git init /tmp/vobject-source \
    && git -C /tmp/vobject-source remote add origin https://github.com/py-vobject/vobject.git \
    && git -C /tmp/vobject-source fetch --depth=1 origin 680ed60eed72d42fe2cbed62ca767320e433a8b4 \
    && git -C /tmp/vobject-source checkout --detach FETCH_HEAD \
    && test "$(git -C /tmp/vobject-source rev-parse HEAD)" = 680ed60eed72d42fe2cbed62ca767320e433a8b4 \
    && mkdir -p /tmp/vobject-wheels \
    && /app/bin/python -m pip wheel \
        --no-build-isolation \
        --no-deps \
        --wheel-dir /tmp/vobject-wheels \
        /tmp/vobject-source \
    && test -f /tmp/vobject-wheels/vobject-1.0.0-py3-none-any.whl

FROM runtime-base AS image-base

COPY --from=vobject-builder /tmp/vobject-wheels/vobject-1.0.0-py3-none-any.whl /tmp/vobject-1.0.0-py3-none-any.whl
RUN /app/bin/python -m pip install \
    --no-cache-dir \
    --no-deps \
    --force-reinstall \
    /tmp/vobject-1.0.0-py3-none-any.whl \
    && rm /tmp/vobject-1.0.0-py3-none-any.whl

COPY --chown=radicale:radicale config /etc/radicale/config
COPY --chown=radicale:radicale src/matrix_calendar_radicale_auth /opt/radicale-auth/src/matrix_calendar_radicale_auth

ENV PYTHONPATH=/opt/radicale-auth/src
USER radicale

FROM image-base AS test
COPY --chown=radicale:radicale tests /opt/radicale-auth/tests
RUN /app/bin/python -m unittest discover -s /opt/radicale-auth/tests -v

FROM image-base AS runtime
