//! Message types generated from `proto/incubator/v1` (see build.rs).

// Request messages of URL-only endpoints (path/query parameters) exist for the contract, not the server.
#![allow(clippy::all, dead_code)]

include!(concat!(env!("OUT_DIR"), "/incubator.v1.rs"));
