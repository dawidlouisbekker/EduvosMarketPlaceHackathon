//! Compiles the API contracts in `proto/` (repo root) into Rust types with prost.
//! protox is a pure-Rust protobuf compiler, so no `protoc` install is needed (locally or in Docker).

use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let proto_dir = PathBuf::from(std::env::var("PROTO_DIR").unwrap_or_else(|_| "../proto".into()));
    let package_dir = proto_dir.join("incubator/v1");

    let mut files: Vec<PathBuf> = std::fs::read_dir(&package_dir)?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| path.extension().is_some_and(|ext| ext == "proto"))
        .collect();
    files.sort();

    println!("cargo:rerun-if-env-changed=PROTO_DIR");
    println!("cargo:rerun-if-changed={}", package_dir.display());
    for file in &files {
        println!("cargo:rerun-if-changed={}", file.display());
    }

    let descriptors = protox::compile(&files, [&proto_dir])?;
    prost_build::Config::new().compile_fds(descriptors)?;
    Ok(())
}
