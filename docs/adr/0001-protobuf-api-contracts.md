# ADR 0001: Protobuf contracts for the frontend ↔ backend API

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

The Expo app (web, iOS, Android) talks to the Rust/axum backend through the Caddy reverse proxy under `/api`.
Until now the only real calls were the authentication endpoints, which used JSON and were described in
`openapi.yaml`. Everything else ran on an in-memory mock layer inside the frontend (`frontend/src/mock`), which
also served as a "demo mode".

Wiring the app to the backend needs a contract that both sides share. Without one, the TypeScript view types and
the Rust structs would be written twice and drift apart. The contract should also keep payloads small on mobile
connections.

## Decision

1. **Every frontend → backend call uses Protocol Buffers, authentication included.** The contracts live in
   [`proto/incubator/v1/`](../../proto/incubator/v1) and are the single source of truth. `openapi.yaml` is removed.

2. **Transport is plain HTTP with REST-shaped routes, not gRPC.**
   - Each rpc in a `service` block has a leading comment that gives its HTTP mapping, e.g.
     `// GET /problems?sort=&cursor=&limit=`. The services are the route table. We do not run a gRPC server.
   - Request and response bodies are binary protobuf with `Content-Type: application/x-protobuf` and
     `Accept: application/x-protobuf`.
   - Resource ids go in the path, and filters (`sort`, `cursor`, `limit`, `q`) go in the query string. Each rpc's
     request message mirrors those parameters, so the whole call is described in one place. For `POST`/`PUT`/
     `PATCH`/`DELETE` the client sends the encoded request message as the body, and the server takes
     path/query-bound fields from the URL.
   - Enum values in a query string are written as the lower-case value name without the enum prefix
     (`FEED_SORT_TOP` → `sort=top`).
   - A response with no fields is sent as `204 No Content`.
   - Every non-2xx response has an `incubator.v1.Error { code, message }` body.

3. **Authentication keeps its mechanics and moves to protobuf.** Sessions are still an HttpOnly cookie (web) or a
   bearer token (native), and cookie-authenticated writes still require a same-origin `Origin` header (CSRF).
   `POST /auth/app/exchange`, `POST /auth/logout` and `GET /me` use protobuf bodies. `GET /auth/login` and
   `GET /auth/callback` are browser navigations: query parameters in, `303` redirect out, with errors reported
   through `?auth_error=` / `?sso=` on the redirect. They cannot carry a body, so `auth.proto` specifies them
   with messages whose fields are the query parameters.
   `GET /health` is an infrastructure probe for Docker and the proxy, not a frontend call, so it stays plain JSON.

4. **Conventions**
   - Package `incubator.v1`. Breaking changes go into a new package (`incubator.v2`). Field numbers are never
     reused, and removed fields are `reserved`.
   - Ids (UUIDv7) are `string`. Times are `google.protobuf.Timestamp`.
   - Scalars that can be absent are proto3 `optional`. Message-typed fields always have presence; the comment
     says when one can be absent.
   - Every enum starts with `*_UNSPECIFIED = 0`.
   - Counts are `int32`, so JavaScript never needs 64-bit integers except inside `Timestamp`.
   - Limits from the database schema (`varchar(n)`) are written next to the field, e.g. `// max 128`. The backend
     enforces them.
   - `buf lint` (STANDARD rules) and `buf breaking` run against `proto/`.

5. **Code generation**
   - **Backend:** `prost` types, compiled in `backend/build.rs` with `protox` (a pure-Rust protobuf compiler, so
     neither developers nor the Docker build need `protoc`). An axum `Proto<T>` extractor/responder
     handles decoding and encoding, and `AppError` renders `incubator.v1.Error`.
   - **Frontend:** `ts-proto`, run through `buf generate` (`frontend/buf.gen.yaml`, `pnpm gen`). The output in
     `frontend/src/gen/` is committed. The options `snakeToCamel=false` and `useDate=string` keep field names
     identical to the proto/database names (`created_at`, not `createdAt`) and turn `Timestamp` into ISO-8601
     strings. The existing UI code keeps working largely unchanged.
   - The generated messages are the frontend's model types. `frontend/src/types/models.ts` only re-exports
     them, and defines a few flattened convenience types (e.g. `ProjectDetail = Project & …`).

6. **No demo data in the client.** The frontend mock layer and its "Explore with demo data" button are removed.
   Demo content is seeded into the database by migration `0002_reference_data.sql`, together with the reference
   data every deployment needs (comment types, the skills list).

## Consequences

- One contract drives both sides. A field added in a `.proto` shows up as a compile error wherever it is not
  handled, on either side.
- Payloads are smaller than JSON and parse cheaply on phones.
- Payloads are not human-readable in browser devtools or `curl`. To inspect them, decode with
  `buf curl`/`protoc --decode`, or log the generated object in development.
- Any contract change needs `pnpm gen` in `frontend/` (the backend regenerates on `cargo build`). CI should check
  that `frontend/src/gen` is up to date.
- The Docker build context of the backend must include `proto/`.
- The app always needs a running backend and a signed-in user. There is no offline demo.

## Alternatives considered

- **JSON + OpenAPI with code generation.** Readable, but the spec and the generators are looser (nullability,
  enums), and the payloads are larger. JSON was the status quo for auth only.
- **gRPC-Web / Connect.** It would give generated clients, but it adds a protocol runtime and proxy behaviour on top
  of the existing REST + Caddy setup, and doesn't fit the browser-redirect OIDC flow. Plain HTTP with protobuf
  bodies gets the typed contract without that.
- **`@bufbuild/protoc-gen-es` for TypeScript.** It is the more common generator, but it always renames fields to
  camelCase and represents `Timestamp` as a message. That would mean rewriting every screen and diverging from
  the snake_case names used by the database and the Rust code.
