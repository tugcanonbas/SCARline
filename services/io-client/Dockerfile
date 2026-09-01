FROM python:3.12-slim

WORKDIR /app

COPY services/io-client /app/services/io-client
RUN pip install --no-cache-dir /app/services/io-client

ENTRYPOINT ["python", "-m", "scarline_io"]
