FROM python:3.11-slim

WORKDIR /app

COPY services/carla-client/pyproject.toml /tmp/carla-client/pyproject.toml
COPY services/carla-client/scarline_carla /tmp/carla-client/scarline_carla
RUN pip install --no-cache-dir /tmp/carla-client

ENTRYPOINT ["scarline-carla-client"]
