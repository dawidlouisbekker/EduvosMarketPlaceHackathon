# syntax=docker/dockerfile:1
FROM rust:1-slim-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release && cp target/release/reverse-proxy /reverse-proxy

FROM gcr.io/distroless/cc-debian12
COPY --from=build /reverse-proxy /reverse-proxy
EXPOSE 8080
ENTRYPOINT ["/reverse-proxy"]
