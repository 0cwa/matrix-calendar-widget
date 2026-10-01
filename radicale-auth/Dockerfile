FROM ghcr.io/kozea/radicale:3.8.0@sha256:0d60d544710bda0fa83bfdea685db731b6cbf74e12d7f22b4997e9cff3a50468 AS runtime-base

USER root
RUN mkdir -p /etc/radicale /data/collections \
    && chown -R radicale:radicale /etc/radicale /data

COPY --chown=radicale:radicale config /etc/radicale/config
COPY --chown=radicale:radicale src/matrix_calendar_radicale_auth /opt/radicale-auth/src/matrix_calendar_radicale_auth

ENV PYTHONPATH=/opt/radicale-auth/src
USER radicale

FROM runtime-base AS test
COPY --chown=radicale:radicale tests /opt/radicale-auth/tests
RUN /app/bin/python -m unittest discover -s /opt/radicale-auth/tests -v

FROM runtime-base AS runtime
