# Package validator with Python 3.13 (latest)
FROM --platform=$BUILDPLATFORM python:3.13-alpine AS builder

# Enable Python debug mode for better error messages
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONFAULTHANDLER=1

RUN apk add --no-cache \
    bash \
    bash-completion \
    bash-doc \
    gfortran \
    git \
    musl-dev \
    tar \
    wget

USER root
WORKDIR /home/registry

# Set up fpm
RUN wget https://github.com/fortran-lang/fpm/releases/download/v0.9.0/fpm-0.9.0-linux-x86_64 -4 -O fpm && \
    chmod u+x fpm


WORKDIR /src
COPY requirements.txt /src
RUN --mount=type=cache,target=/root/.cache/pip \
    pip3 install -r requirements.txt

COPY . .

CMD ["python3", "validate.py"]