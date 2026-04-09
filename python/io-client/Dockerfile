FROM python:3.11-slim

WORKDIR /workspace/python/io-client

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential linux-libc-dev pkg-config \
  && rm -rf /var/lib/apt/lists/*

COPY python/io-client/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY python/io-client/. .

CMD ["python", "-m", "scarline_io"]
