//! Data from a URL (the old app's Data URL, back).
//!
//! The print screen's **Data URL** field fetches a job's data over
//! HTTP before the job runs: one page per record in the response,
//! the same way typed or file data does. The response body comes back
//! as plain text — JSON or CSV, the pipeline's call — so this module
//! never parses data, it only fetches it.
//!
//! A data URL is untrusted input: a deep link
//! (`printninja://print?dataUrl=…`) or a person at the keyboard can
//! set it, so the fetch is guarded before any connection —
//! `http`/`https` only, no loopback, link-local, private or otherwise
//! non-public address (including the cloud metadata endpoint), at most
//! five redirects, each hop re-checked, fifteen seconds and five
//! megabytes at most. The setting `data.block_private_ips`
//! (Settings → Data) switches the address check off for printers on a
//! LAN that serve data from `http://192.168.…/data.json`.

use std::net::IpAddr;
use std::time::Duration;

/// The fetch's patience, in seconds (the old app's value).
const TIMEOUT_SECS: u64 = 15;
/// The body's ceiling, in bytes: five megabytes (the old app's value).
const MAX_SIZE_BYTES: u64 = 5 * 1024 * 1024;
/// One initial request plus up to five redirects, the same limit the
/// old automatic policy had.
const MAX_HOPS: u64 = 6;

pub struct DataFetcher {
    /// Skip the address checks. The setting
    /// `data.block_private_ips` off, and tests that fetch from a
    /// loopback listener, set it.
    allow_private: bool,
}

impl DataFetcher {
    /// The guarded fetcher: the address checks run on every hop.
    pub fn new() -> Self {
        Self {
            allow_private: false,
        }
    }

    /// The unguarded fetcher: for the setting off and for tests.
    pub fn allowing_private() -> Self {
        Self {
            allow_private: true,
        }
    }

    /// Fetch the URL's body text: the method is normalized (garbage is
    /// a GET), redirects are followed by hand so every hop goes
    /// through `validate_and_pin`, and the size limit is enforced on
    /// the bytes actually received, not on a `Content-Length` hint.
    pub async fn fetch(&self, url: &str, method: &str) -> Result<String, String> {
        let original = url.to_string();
        let mut url = reqwest::Url::parse(&original).map_err(|e| format!("not a URL: {e}"))?;
        let mut method = normalize_method(method);

        for _hop in 0..MAX_HOPS {
            // Validate first, then pin: this hop's client connects to
            // exactly the addresses vetted above, so a DNS answer that
            // changes before the connect (rebinding) cannot steer the
            // request to an address the guard refused.
            let pin = validate_and_pin(&url, self.allow_private).await?;
            let mut builder = reqwest::Client::builder()
                .timeout(Duration::from_secs(TIMEOUT_SECS))
                .redirect(reqwest::redirect::Policy::none());
            if let Some((host, addrs)) = &pin {
                builder = builder.resolve_to_addrs(host, addrs);
            }
            let client = builder
                .build()
                .map_err(|e| format!("could not build the fetch: {e}"))?;

            let mut response = client
                .request(method.clone(), url.clone())
                .send()
                .await
                .map_err(|e| format!("fetching {original}: {e}"))?;
            let status = response.status();

            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok());
            if let Some(next) = redirect_target(status, location, &url)? {
                // 301/302/303 drop a body-carrying method; 307/308 keep
                // it (there is no body either way — the method matters).
                if matches!(status.as_u16(), 301..=303) {
                    method = reqwest::Method::GET;
                }
                url = next;
                continue;
            }

            if !status.is_success() {
                return Err(format!("HTTP {status} from {original}"));
            }

            // `content_length` is a hint from the server and is absent
            // for chunked responses — an over-long body can arrive
            // without one. Read the body in chunks and enforce the
            // limit on the bytes actually received, dropping the
            // connection the moment it is crossed.
            let mut body: Vec<u8> = Vec::new();
            loop {
                let chunk = response
                    .chunk()
                    .await
                    .map_err(|e| format!("fetching {original}: {e}"))?;
                match chunk {
                    Some(bytes) => {
                        body.extend_from_slice(&bytes);
                        if body.len() as u64 > MAX_SIZE_BYTES {
                            return Err(format!(
                                "response too large: more than {MAX_SIZE_BYTES} bytes (max {MAX_SIZE_BYTES})"
                            ));
                        }
                    }
                    None => break,
                }
            }

            return Ok(String::from_utf8_lossy(&body).into_owned());
        }

        Err(format!("more than 5 redirects fetching {original}"))
    }
}

/// Check one hop: `http`/`https` only, and every address the host
/// resolves to must be publicly routable. Called for the first URL and
/// again for every redirect — which is what stops a permitted host
/// from redirecting the fetch into the LAN or at the cloud metadata
/// endpoint.
///
/// When the host is a domain name, the vetted addresses are returned
/// so the caller can pin them to the client with `resolve_to_addrs`:
/// the connect then uses exactly these addresses, so a DNS rebinding
/// between this check and the connect cannot steer the fetch at an
/// address we refused. IP literals (and `allow_private` callers) need
/// no pinning.
async fn validate_and_pin(
    url: &reqwest::Url,
    allow_private: bool,
) -> Result<Option<(String, Vec<std::net::SocketAddr>)>, String> {
    match url.scheme() {
        "http" | "https" => {}
        other => {
            return Err(format!(
                "refused scheme '{other}' in the data URL (only http and https)"
            ))
        }
    }
    if allow_private {
        return Ok(None);
    }

    // `host_str()` brackets IPv6 literals ("[::1]"), which DNS cannot
    // parse. An IP literal also needs no resolution or pinning: the
    // address *is* the destination, so the policy check sees exactly
    // what will be connected to. Only real domain names go through
    // DNS.
    let host = url
        .host_str()
        .ok_or_else(|| "the data URL has no host".to_string())?;
    let bare = host
        .strip_prefix('[')
        .and_then(|h| h.strip_suffix(']'))
        .unwrap_or(host);

    if let Ok(ip) = bare.parse::<IpAddr>() {
        if is_forbidden_addr(ip) {
            return Err(format!(
                "refused data URL {url}: '{host}' targets {ip} (loopback, link-local or private)"
            ));
        }
        return Ok(None);
    }

    let port = url.port_or_known_default().unwrap_or(80);
    let addrs: Vec<std::net::SocketAddr> = tokio::net::lookup_host((bare, port))
        .await
        .map_err(|e| format!("resolving '{host}': {e}"))?
        .collect();
    if addrs.is_empty() {
        return Err(format!("data URL host '{host}' does not resolve"));
    }
    for addr in &addrs {
        if is_forbidden_addr(addr.ip()) {
            return Err(format!(
                "refused data URL {url}: '{host}' resolves to {} (loopback, link-local or private)",
                addr.ip()
            ));
        }
    }
    Ok(Some((host.to_string(), addrs)))
}

/// Addresses a job's data never legitimately comes from: loopback,
/// link-local (which includes the cloud metadata endpoint
/// 169.254.169.254), RFC1918 private, carrier-grade NAT, unique-local
/// (fc00::/7), unspecified and multicast.
pub(crate) fn is_forbidden_addr(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                // 100.64.0.0/10 carrier-grade NAT (Ipv4Addr::is_shared
                // is still unstable).
                || (u32::from(v4) & 0xffc0_0000) == 0x6440_0000
                || v4.is_unspecified()
                || v4.is_multicast()
        }
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_forbidden_addr(IpAddr::V4(mapped));
            }
            v6.is_loopback()
                || v6.is_unicast_link_local()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (v6.segments()[0] & 0xfe00) == 0xfc00
        }
    }
}

/// The next hop of a redirect, or `None` when the response is final.
/// Relative `Location` values resolve against the URL that sent them.
fn redirect_target(
    status: reqwest::StatusCode,
    location: Option<&str>,
    base: &reqwest::Url,
) -> Result<Option<reqwest::Url>, String> {
    if !status.is_redirection() {
        return Ok(None);
    }
    let location = location
        .ok_or_else(|| format!("redirect {status} without a Location header from {base}"))?;
    base.join(location)
        .map(Some)
        .map_err(|e| format!("bad Location in a redirect from {base}: {e}"))
}

/// Normalize a method from a text field: trim, uppercase, whitelist.
/// Anything outside the list is a GET — the old app surfaced method
/// garbage as an error, and a data URL's method is not worth failing a
/// preview over.
pub(crate) fn normalize_method(raw: &str) -> reqwest::Method {
    let upper = raw.trim().to_ascii_uppercase();
    match upper.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        _ => reqwest::Method::GET,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Accepts one connection, reads the request, sends `resp`, then
    /// closes cleanly. The server must read the request before
    /// closing: on Windows, closing a socket with unread data sends a
    /// RST, which discards the response before the client reads it
    /// (os error 10053).
    async fn serve_once(resp: String) -> std::net::SocketAddr {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut req = Vec::new();
            let mut buf = [0u8; 1024];
            while !req.windows(4).any(|w| w == b"\r\n\r\n") {
                match socket.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => req.extend_from_slice(&buf[..n]),
                }
            }
            let _ = socket.write_all(resp.as_bytes()).await;
            let _ = socket.flush().await;
            let _ = socket.shutdown().await;
            // Wait for the client to close its side before dropping the
            // socket.
            let _ = tokio::time::timeout(Duration::from_secs(2), async {
                while let Ok(n) = socket.read(&mut buf).await {
                    if n == 0 {
                        break;
                    }
                }
            })
            .await;
        });
        addr
    }

    /// Fetch `resp` from a loopback listener and hand back the body —
    /// the tests that care about the body need the guard off.
    async fn fetch_once(resp: String) -> String {
        let addr = serve_once(resp).await;
        DataFetcher::allowing_private()
            .fetch(&format!("http://{addr}/data"), "GET")
            .await
            .unwrap()
    }

    fn json_response(body: &str) -> String {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: application/json\r\n\r\n{}",
            body.len(),
            body
        )
    }

    #[test]
    fn method_validation_trims_and_uppercases() {
        assert_eq!(normalize_method("get"), reqwest::Method::GET);
        assert_eq!(normalize_method("  POST  "), reqwest::Method::POST);
        assert_eq!(normalize_method("put"), reqwest::Method::PUT);
    }

    #[test]
    fn method_validation_defaults_to_get_for_garbage() {
        assert_eq!(normalize_method(""), reqwest::Method::GET);
        assert_eq!(normalize_method("   "), reqwest::Method::GET);
        assert_eq!(normalize_method("GET "), reqwest::Method::GET);
        assert_eq!(normalize_method("NOTAMETHOD"), reqwest::Method::GET);
        assert_eq!(normalize_method("get\n"), reqwest::Method::GET);
    }

    #[tokio::test]
    async fn a_fetch_returns_the_body_text() {
        let body = fetch_once(json_response(r#"{"ok": true}"#)).await;
        assert_eq!(body, r#"{"ok": true}"#);
    }

    #[tokio::test]
    async fn a_csv_body_comes_back_as_text_too() {
        // The fetcher never parses data — CSV is a legitimate data
        // source for the pipeline.
        let body = fetch_once(json_response("name,qty\r\nAda,3\r\n")).await;
        assert_eq!(body, "name,qty\r\nAda,3\r\n");
    }

    #[tokio::test]
    async fn a_non_2xx_response_is_named() {
        let addr =
            serve_once("HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\n\r\nnot found".to_string())
                .await;
        let err = DataFetcher::allowing_private()
            .fetch(&format!("http://{addr}/data"), "GET")
            .await
            .unwrap_err();
        assert!(err.contains("HTTP 404"), "{err}");
    }

    #[tokio::test]
    async fn a_redirect_without_a_location_is_an_error() {
        let addr = serve_once("HTTP/1.1 302 Found\r\nContent-Length: 0\r\n\r\n".to_string()).await;
        let err = DataFetcher::allowing_private()
            .fetch(&format!("http://{addr}/data"), "GET")
            .await
            .unwrap_err();
        assert!(err.contains("without a Location"), "{err}");
    }

    #[tokio::test]
    async fn size_limit_is_enforced_on_chunked_bodies() {
        // A body streamed without Content-Length, one byte over the
        // ceiling: the header-only check would never see it.
        let body = "a".repeat(MAX_SIZE_BYTES as usize + 1);
        let json = format!("\"{body}\"");
        let resp = format!(
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Type: application/json\r\n\r\n{:x}\r\n{json}\r\n0\r\n\r\n",
            json.len()
        );
        let addr = serve_once(resp).await;
        let err = DataFetcher::allowing_private()
            .fetch(&format!("http://{addr}/data"), "GET")
            .await
            .unwrap_err();
        assert!(err.contains("too large"), "{err}");
    }

    // ───────────────────────────────────────────────────────────────
    // The guard: a data URL is untrusted input and cannot reach
    // non-public hosts
    // ───────────────────────────────────────────────────────────────

    #[test]
    fn loopback_private_and_link_local_addresses_are_forbidden() {
        let ip = |s: &str| s.parse::<IpAddr>().unwrap();
        for addr in [
            "127.0.0.1",
            "127.8.9.10",
            "::1",
            "10.0.0.1",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.169.254", // cloud metadata lives here
            "fe80::1",
            "fd00::1",
            "fc00::1",
            "100.64.0.1", // carrier-grade NAT
            "0.0.0.0",
            "::",
            "::ffff:127.0.0.1", // IPv4-mapped loopback
        ] {
            assert!(is_forbidden_addr(ip(addr)), "{addr} must be refused");
        }
        for addr in [
            "8.8.8.8",
            "1.1.1.1",
            "93.184.216.34",
            "2606:4700:4700::1111",
        ] {
            assert!(!is_forbidden_addr(ip(addr)), "{addr} must be allowed");
        }
    }

    #[tokio::test]
    async fn only_http_and_https_schemes_are_fetched() {
        for url in [
            "file:///etc/passwd",
            "ftp://example.com/x",
            "gopher://example.com/7",
        ] {
            let err = validate_and_pin(&reqwest::Url::parse(url).unwrap(), false)
                .await
                .unwrap_err();
            assert!(err.contains("scheme"), "{url} -> {err}");
        }
    }

    #[tokio::test]
    async fn loopback_and_metadata_urls_are_refused() {
        for url in [
            "http://127.0.0.1:8080/x",
            "http://localhost:8080/x", // resolves to loopback
            "http://[::1]/x",
            "http://169.254.169.254/latest/meta-data/",
            "http://10.1.2.3/x",
            "http://192.168.1.10/x",
            "https://[fd00::1]/x",
        ] {
            let err = validate_and_pin(&reqwest::Url::parse(url).unwrap(), false)
                .await
                .unwrap_err();
            assert!(err.contains("refused"), "{url} -> {err}");
        }
    }

    /// The guard runs before any connection: the fetch fails with the
    /// reason even when the refusal is the whole outcome.
    #[tokio::test]
    async fn fetch_refuses_a_loopback_data_url() {
        let err = DataFetcher::new()
            .fetch("http://127.0.0.1:9/x", "GET")
            .await
            .unwrap_err();
        assert!(err.contains("refused"), "{err}");
    }

    #[test]
    fn redirect_targets_are_resolved_against_the_base_url() {
        let base = reqwest::Url::parse("http://example.com/a/b").unwrap();
        let found = reqwest::StatusCode::FOUND;

        let abs = redirect_target(found, Some("/next"), &base)
            .unwrap()
            .unwrap();
        assert_eq!(abs.as_str(), "http://example.com/next");

        let rel = redirect_target(found, Some("next"), &base)
            .unwrap()
            .unwrap();
        assert_eq!(rel.as_str(), "http://example.com/a/next");

        // Every hop — wherever it points — goes through
        // validate_and_pin.
        let cross = redirect_target(found, Some("http://other.example/z"), &base)
            .unwrap()
            .unwrap();
        assert_eq!(cross.host_str(), Some("other.example"));

        assert!(
            redirect_target(reqwest::StatusCode::OK, None, &base)
                .unwrap()
                .is_none(),
            "a final response is not a hop"
        );
        assert!(
            redirect_target(found, None, &base).is_err(),
            "a redirect without a Location header is an error"
        );
    }
}
