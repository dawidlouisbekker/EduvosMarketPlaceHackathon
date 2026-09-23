//! Minimal, dependency-free HTTP/1.x reverse proxy.
//!
//! Configuration via environment variables:
//!   LISTEN  address to bind            (default "0.0.0.0:8080")
//!   ROUTES  comma separated prefix=host:port pairs, longest prefix wins
//!           (default "/api=127.0.0.1:8090,/=127.0.0.1:8081")
//!           e.g. ROUTES="/api=10.0.0.5:9000,/=10.0.0.6:9001"
//!
//! Each client connection is routed on its first request, then bytes are piped
//! both ways. `Connection: close` is forced upstream so a single connection never
//! carries requests for different routes. WebSocket upgrades are passed through.

use std::env;
use std::io::{self, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

const MAX_HEAD: usize = 16 * 1024;
const STACK_SIZE: usize = 64 * 1024;
const HEAD_TIMEOUT: Duration = Duration::from_secs(10);
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(300);

struct Route {
    prefix: String,
    upstream: String,
}

fn main() {
    let listen = env::var("LISTEN").unwrap_or_else(|_| "127.0.0.1:8080".into());
    let routes = env::var("ROUTES").unwrap_or_else(|_| "/api=127.0.0.1:8090,/=127.0.0.1:8081".into());
    let routes = Arc::new(parse_routes(&routes));

    let listener = TcpListener::bind(&listen).unwrap_or_else(|e| {
        eprintln!("failed to bind {listen}: {e}");
        std::process::exit(1);
    });
    println!("listening on {listen}");
    for r in routes.iter() {
        println!("  {} -> {}", r.prefix, r.upstream);
    }

    for stream in listener.incoming() {
        let Ok(client) = stream else { continue };
        let routes = Arc::clone(&routes);
        let spawned = thread::Builder::new()
            .stack_size(STACK_SIZE)
            .spawn(move || {
                if let Err(e) = handle(client, &routes) {
                    eprintln!("connection error: {e}");
                }
            });
        if let Err(e) = spawned {
            eprintln!("failed to spawn thread: {e}");
        }
    }
}

fn parse_routes(spec: &str) -> Vec<Route> {
    let mut routes: Vec<Route> = spec
        .split(',')
        .filter_map(|entry| {
            let (prefix, upstream) = entry.trim().split_once('=')?;
            Some(Route {
                prefix: prefix.trim().into(),
                upstream: upstream.trim().into(),
            })
        })
        .collect();
    if routes.is_empty() {
        eprintln!("ROUTES is empty or malformed");
        std::process::exit(1);
    }
    routes.sort_by(|a, b| b.prefix.len().cmp(&a.prefix.len()));
    routes
}

/// "/api" matches "/api", "/api/x" and "/api?q" but not "/apiary".
fn matches(path: &str, prefix: &str) -> bool {
    match path.strip_prefix(prefix) {
        Some(rest) => prefix.ends_with('/') || rest.is_empty() || rest.starts_with(['/', '?']),
        None => false,
    }
}

fn respond(client: &mut TcpStream, status: &str) -> io::Result<()> {
    write!(client, "HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
}

fn invalid(msg: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, msg)
}

/// Reads until the end of the request head. Returns the buffer and the head length;
/// any bytes past the head (start of the body) are left in the buffer.
fn read_head(client: &mut TcpStream) -> io::Result<(Vec<u8>, usize)> {
    let mut buf = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    loop {
        let n = client.read(&mut chunk)?;
        if n == 0 {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "client closed before sending head"));
        }
        let search_from = buf.len().saturating_sub(3);
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = buf[search_from..].windows(4).position(|w| w == b"\r\n\r\n") {
            return Ok((buf, search_from + pos + 4));
        }
        if buf.len() > MAX_HEAD {
            return Err(invalid("request head too large"));
        }
    }
}

fn handle(mut client: TcpStream, routes: &[Route]) -> io::Result<()> {
    client.set_read_timeout(Some(HEAD_TIMEOUT))?;
    let peer = client.peer_addr()?.ip();

    let (buf, head_len) = match read_head(&mut client) {
        Ok(v) => v,
        Err(e) if e.kind() == io::ErrorKind::InvalidData => {
            respond(&mut client, "431 Request Header Fields Too Large")?;
            return Err(e);
        }
        Err(e) => return Err(e),
    };

    let Ok(head) = std::str::from_utf8(&buf[..head_len]) else {
        respond(&mut client, "400 Bad Request")?;
        return Err(invalid("non-utf8 request head"));
    };
    let mut lines = head.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let Some(path) = request_line.split(' ').nth(1) else {
        respond(&mut client, "400 Bad Request")?;
        return Err(invalid("malformed request line"));
    };

    let Some(route) = routes.iter().find(|r| matches(path, &r.prefix)) else {
        return respond(&mut client, "404 Not Found");
    };

    let mut upstream = match TcpStream::connect(&route.upstream) {
        Ok(s) => s,
        Err(e) => {
            respond(&mut client, "502 Bad Gateway")?;
            return Err(e);
        }
    };

    // Rebuild the head: drop hop-by-hop connection headers, append X-Forwarded-For.
    let mut out = String::with_capacity(head_len + 128);
    out.push_str(request_line);
    out.push_str("\r\n");
    let mut upgrade = false;
    let mut forwarded_for = None;
    for line in lines.filter(|l| !l.is_empty()) {
        let (name, value) = line.split_once(':').unwrap_or((line, ""));
        let value = value.trim();
        if name.eq_ignore_ascii_case("connection") {
            upgrade |= value.to_ascii_lowercase().contains("upgrade");
        } else if name.eq_ignore_ascii_case("x-forwarded-for") {
            forwarded_for = Some(value);
        } else if !name.eq_ignore_ascii_case("keep-alive") && !name.eq_ignore_ascii_case("proxy-connection") {
            out.push_str(line);
            out.push_str("\r\n");
        }
    }
    out.push_str(if upgrade { "Connection: upgrade\r\n" } else { "Connection: close\r\n" });
    match forwarded_for {
        Some(prev) => out.push_str(&format!("X-Forwarded-For: {prev}, {peer}\r\n")),
        None => out.push_str(&format!("X-Forwarded-For: {peer}\r\n")),
    }
    out.push_str("\r\n");

    upstream.write_all(out.as_bytes())?;
    upstream.write_all(&buf[head_len..])?;
    drop(buf);

    client.set_read_timeout(None)?;
    if !upgrade {
        upstream.set_read_timeout(Some(UPSTREAM_TIMEOUT))?;
    }

    // client -> upstream on a helper thread, upstream -> client on this one.
    let mut client_read = client.try_clone()?;
    let mut upstream_write = upstream.try_clone()?;
    let pump = thread::Builder::new().stack_size(STACK_SIZE).spawn(move || {
        let _ = io::copy(&mut client_read, &mut upstream_write);
        let _ = upstream_write.shutdown(Shutdown::Write);
    })?;

    let result = io::copy(&mut upstream, &mut client);
    // Upstream is done; tear down the client side so the pump thread unblocks.
    let _ = client.shutdown(Shutdown::Both);
    let _ = upstream.shutdown(Shutdown::Both);
    let _ = pump.join();
    result.map(|_| ())
}
