FROM python:3.12-slim

WORKDIR /srv/backend
# Cài thư viện trước để tận dụng cache; mã nguồn được mount lúc chạy (xem docker-compose.yml).
COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-dev.txt
COPY . .
ENV PYTHONPATH=/srv/backend PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
