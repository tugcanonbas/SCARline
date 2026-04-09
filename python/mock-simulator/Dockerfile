FROM python:3.11-slim

WORKDIR /workspace/python/mock-simulator

COPY python/mock-simulator/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY python/mock-simulator/. .

CMD ["python", "-m", "scarline_mock"]
