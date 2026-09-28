# syntax=docker/dockerfile:1
# Build context is the repository root (the build needs ../proto); see Dockerfile.dockerignore.
FROM rust:1-slim-bookworm AS build
WORKDIR /app/backend
COPY proto /app/proto
COPY backend/Cargo.toml backend/Cargo.lock backend/build.rs ./
COPY backend/migrations ./migrations
COPY backend/src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/backend/target \
    cargo build --release && cp target/release/backend /backend

FROM gcr.io/distroless/cc-debian12
COPY --from=build /backend /backend
EXPOSE 8090
ENTRYPOINT ["/backend"]
