# Eduvos Entrepreneur Incubator

- `frontend/`: Expo app (web, iOS, Android)
- `backend/`: Rust/axum API with Postgres
- `proto/`: the API contracts. Every frontend ↔ backend call uses protobuf bodies; see
  [ADR 0001](docs/adr/0001-protobuf-api-contracts.md). After changing a `.proto`, run `pnpm gen` in `frontend/`
  (the backend regenerates on `cargo build`).

## Demo data

The app has no offline demo mode. Migration `backend/migrations/0002_reference_data.sql` seeds every database with
demo users, problems, ideas, projects, votes, comments, vouches and notifications.
