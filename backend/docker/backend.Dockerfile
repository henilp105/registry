# Prod environment with Python 3.13 (latest)
FROM --platform=$BUILDPLATFORM python:3.13-bookworm AS builder

# Enable Python debug mode for better error messages
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONFAULTHANDLER=1

WORKDIR /src
COPY requirements.txt /src
RUN --mount=type=cache,mode=0777,target=/root/.cache/pip \
    pip3 install -r requirements.txt

COPY . .

CMD ["python3", "server.py"]

