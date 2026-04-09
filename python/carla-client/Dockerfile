FROM python:3.11-slim

WORKDIR /workspace/python/carla-client

COPY python/carla-client/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY python/carla-client/. .

CMD ["python", "-m", "scarline_carla"]
