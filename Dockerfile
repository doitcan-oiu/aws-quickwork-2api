FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS frontend
WORKDIR /src/web
COPY web/package.json web/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm run build

FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY web/ui.go ./web/
COPY --from=frontend /src/web/dist/ ./web/dist/
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" go build \
    -trimpath -ldflags="-s -w" -o /quickproxy ./cmd/quickproxy

FROM alpine:3.24
WORKDIR /app
RUN apk add --no-cache ca-certificates \
    && mkdir -m 0700 data && chown 10001:10001 data \
    && printf '{}\n' > config.json
COPY --from=builder /quickproxy /usr/local/bin/quickproxy
COPY LICENSE /usr/share/licenses/quickproxy/LICENSE
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["quickproxy"]
CMD ["serve", "-addr", "0.0.0.0:8080"]
