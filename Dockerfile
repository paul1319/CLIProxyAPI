FROM oven/bun:1.3.14 AS bun-runtime

FROM node:24-bookworm AS panel-builder

COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /panel
COPY management-ui/package.json management-ui/bun.lock ./
RUN bun install --frozen-lockfile
COPY management-ui/ ./
ARG VERSION=dev
RUN --network=none bun run verify

FROM golang:1.26-bookworm AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends build-essential git && rm -rf /var/lib/apt/lists/*

COPY go.mod go.sum ./

RUN go mod download

COPY . .

ARG VERSION=dev
ARG COMMIT=none
ARG BUILD_DATE=unknown

RUN CGO_ENABLED=1 GOOS=linux go build -buildvcs=false -ldflags="-s -w -X 'main.Version=${VERSION}' -X 'main.Commit=${COMMIT}' -X 'main.BuildDate=${BUILD_DATE}'" -o ./CLIProxyAPI ./cmd/server/

FROM debian:bookworm

RUN apt-get update && apt-get install -y --no-install-recommends tzdata ca-certificates && rm -rf /var/lib/apt/lists/*

RUN mkdir /CLIProxyAPI

COPY --from=builder ./app/CLIProxyAPI /CLIProxyAPI/CLIProxyAPI
COPY --from=panel-builder /panel/dist/index.html /CLIProxyAPI/static/management.html
COPY --from=panel-builder /panel/LICENSE /CLIProxyAPI/static/LICENSE

COPY config.example.yaml /CLIProxyAPI/config.example.yaml

WORKDIR /CLIProxyAPI

EXPOSE 8317

ENV TZ=Asia/Shanghai
ENV MANAGEMENT_STATIC_PATH=/CLIProxyAPI/static MANAGEMENT_DISABLE_AUTO_UPDATE=true

RUN cp /usr/share/zoneinfo/${TZ} /etc/localtime && echo "${TZ}" > /etc/timezone

CMD ["./CLIProxyAPI"]
