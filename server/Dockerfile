# ---- stage 1: build the admin UI ----
FROM node:24-alpine AS web
WORKDIR /app/web
COPY web/ ./
RUN npm install --no-audit --no-fund && npm run build

# ---- stage 2: build the server ----
FROM rust:1.85-bookworm AS build
WORKDIR /build
COPY Cargo.toml ./
COPY src/ ./src/
RUN cargo build --release

# ---- stage 3: runtime ----
FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=web /app/web/dist /app/web/dist
COPY --from=build /build/target/release/markmax-server /usr/local/bin/markmax-server
ENV MARKMAX_DATA_DIR=/data
ENV MARKMAX_WEB_DIR=/app/web/dist
VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["markmax-server"]
# 端口/数据目录/token 均可用环境变量覆盖（MARKMAX_PORT / MARKMAX_DATA_DIR / MARKMAX_TOKEN），
# 不在 CMD 写死 --port，否则 CLI 参数优先级高于环境变量会导致覆盖失效。
