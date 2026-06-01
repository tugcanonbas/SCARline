# ──────────────────────────────────────────────────────────
# Stage 1 — builder: compile native wheels in an isolated venv
# ──────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      gcc g++ \
      linux-libc-dev \
      pkg-config \
 && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY python/io-client/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt \
 && pip uninstall -y pip setuptools \
 && find /opt/venv -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null; true

# ──────────────────────────────────────────────────────────
# Stage 2 — runtime: minimal image with only venv + source
# ──────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

# Runtime-only shared libraries:
#   libglib2.0-0  — required by OpenCV core (GLib threading/IO)
#   libgomp1      — OpenMP parallelism used by numpy/OpenCV
# Note: libgl1 is NOT needed — opencv-python-headless bundles its own
# rendering libs and the bundled .so files in opencv_python_headless.libs
# resolve all GL/video dependencies internally.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libglib2.0-0 \
      libgomp1 \
 && rm -rf /var/lib/apt/lists/*

# Copy pre-built virtualenv from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Non-root user
RUN groupadd --system scarline && useradd --system -g scarline scarline

WORKDIR /workspace/python/io-client

# Copy only the application source
COPY python/io-client/scarline_io/ ./scarline_io/
COPY python/io-client/io-client-config.yaml ./

USER scarline

CMD ["python", "-m", "scarline_io"]
