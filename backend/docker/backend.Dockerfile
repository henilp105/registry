# Prod environment with Python 3.13 (latest)
FROM --platform=$BUILDPLATFORM python:3.13-bookworm AS builder

# Enable Python optimizations for production
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONFAULTHANDLER=1
ENV FLASK_ENV=production

WORKDIR /src
COPY requirements.txt /src
RUN --mount=type=cache,mode=0777,target=/root/.cache/pip \
    pip3 install -r requirements.txt

COPY . .

# Use Gunicorn for production with:
# - 4 worker processes for parallel request handling
# - 30 second timeout to prevent slow requests from blocking
# - Preload app for faster worker startup
CMD ["gunicorn", "--workers=4", "--bind=0.0.0.0:9090", "--timeout=30", "--preload", "--access-logfile=-", "--error-logfile=-", "server:app"]

