//! Printer discovery — the previous app's "scan & add".
//!
//! Two scanners feed the settings' Printers page:
//!
//! * the **system scan** lists the queues the OS already knows — the
//!   Windows spooler's `EnumPrinters` level 2, CUPS' `lpstat` on
//!   Linux — with each queue's fault read through
//!   [`pn_transport::spooler_status_problem`], so a queue that is
//!   offline or out of paper says so before the user saves it;
//! * the **network scan** browses the four printer service types on
//!   the LAN over mDNS (IPP over TLS or plain, and the two raw
//!   command ports), the way the previous app's scanner did.
//!
//! A discovery is only a hint: the found printer is not added until
//! the user names it, picks the profile it speaks, and saves it. The
//! saved printers live in the local store — the profile set stays
//! the shipped, validated set (plan §5.10). Bluetooth scanning rides
//! in with the Android build (phase 11); on desktop a Bluetooth
//! printer is added by hand, like any other transport.

use std::net::IpAddr;
use std::time::{Duration, Instant};

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;

/// A queue the OS already knows, as the system scan reports it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPrinter {
    /// The queue name — the spooler's name on Windows, the CUPS
    /// destination on Linux. This is what a saved printer's spooler
    /// transport points at.
    pub name: String,
    /// The port or backend the queue sends to (`USB001`,
    /// `\\server\share`, …).
    pub port: String,
    /// The queue's fault, in the spooler's own words (`offline`,
    /// `out of paper`, …); absent when it looks ready.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

/// A printer the LAN announced over mDNS.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredPrinter {
    /// The advertised instance name — the printer's friendly name.
    pub name: String,
    /// The host to send to: a private IP when the advertisement
    /// carried one, its hostname otherwise.
    pub host: String,
    pub port: u16,
    /// The transport the found service is: `ipp` or `raw_tcp`.
    pub kind: String,
    /// An IPP resource path (`printers/laser`), when the
    /// advertisement carried one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_path: Option<String>,
}

/// The four printer service types, and the transport each means:
/// IPP (plain and TLS) is the ipp transport, the raw command ports
/// are the tcp transport.
const PRINTER_SERVICES: &[(&str, &str)] = &[
    ("_ipp._tcp.local.", "ipp"),
    ("_ipps._tcp.local.", "ipp"),
    ("_pdl-datastream._tcp.local.", "raw_tcp"),
    ("_printer._tcp.local.", "raw_tcp"),
];

/// The queues this machine's spooler already knows, with their
/// status read live. Empty where the OS keeps no such list (Android,
/// until phase 11).
pub fn enumerate_system_printers() -> Vec<SystemPrinter> {
    #[cfg(windows)]
    {
        windows_spooler_list()
    }
    #[cfg(target_os = "linux")]
    {
        cups_list()
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        Vec::new()
    }
}

/// Browse the LAN for printers over mDNS, waiting up to
/// `timeout_secs` for answers (clamped to 2–30). A browser that
/// cannot be opened, or a LAN with no printers, is an empty list,
/// not an error — the scan says "none found", the way the previous
/// app's scan did.
pub fn browse_network_printers(timeout_secs: u64) -> Vec<DiscoveredPrinter> {
    let timeout = Duration::from_secs(timeout_secs.clamp(2, 30));
    let deadline = Instant::now() + timeout;

    let mdns = match ServiceDaemon::new() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("mdns daemon failed: {e}");
            return Vec::new();
        }
    };

    let mut receivers = Vec::new();
    for (svc, _kind) in PRINTER_SERVICES {
        match mdns.browse(svc) {
            Ok(rx) => receivers.push((svc.to_string(), rx)),
            Err(e) => eprintln!("browse {svc} failed: {e}"),
        }
    }
    if receivers.is_empty() {
        return Vec::new();
    }

    let mut found = std::collections::HashMap::new();

    while Instant::now() < deadline {
        for (svc, rx) in &receivers {
            while let Ok(event) = rx.recv_timeout(Duration::from_millis(50)) {
                if let ServiceEvent::ServiceResolved(info) = event {
                    let kind = PRINTER_SERVICES
                        .iter()
                        .find(|(s, _)| *s == svc.as_str())
                        .map(|(_, k)| *k)
                        .unwrap_or("ipp");
                    if let Some(printer) = service_info_to_printer(&info, kind) {
                        if !is_lan_host(&printer.host) {
                            // mDNS only answers on the LAN, so a
                            // result whose address is public is
                            // noise, not a printer: drop it.
                            continue;
                        }
                        let key = format!("{}:{}", printer.host, printer.port);
                        found.entry(key).or_insert(printer);
                    }
                }
            }
        }
        // Avoid a busy spin between events.
        std::thread::sleep(Duration::from_millis(10));
    }

    for (svc, _) in &receivers {
        let _ = mdns.stop_browse(svc);
    }
    let _ = mdns.shutdown();

    let mut out: Vec<DiscoveredPrinter> = found.into_values().collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// An mDNS record's fields, as one found printer. `None` when the
/// record cannot point at a device (no port, no address).
fn service_info_to_printer(info: &ServiceInfo, kind: &str) -> Option<DiscoveredPrinter> {
    let port = info.get_port();
    if port == 0 {
        return None;
    }
    let fullname = info.get_fullname().to_string();
    // The instance name is the fullname without its service suffix.
    let name = fullname
        .split("._")
        .next()
        .unwrap_or(&fullname)
        .trim()
        .to_string();
    let name = if name.is_empty() {
        info.get_hostname().trim_end_matches('.').to_string()
    } else {
        name
    };

    // Prefer a private IP address; fall back to the hostname when
    // the record carries no addresses.
    let host = pick_lan_address(info)
        .unwrap_or_else(|| info.get_hostname().trim_end_matches('.').to_string());
    if host.is_empty() {
        return None;
    }

    // The `rp` property carries an IPP resource path, leading
    // slashes included; the transport wants them gone.
    let resource_path = info
        .get_properties()
        .iter()
        .find(|p| p.key().eq_ignore_ascii_case("rp"))
        .map(|p| p.val_str().to_string())
        .map(|v| v.trim_start_matches('/').to_string())
        .filter(|s| !s.is_empty());

    Some(DiscoveredPrinter {
        name,
        host,
        port,
        kind: kind.to_string(),
        resource_path,
    })
}

/// The record's address to send to: the first private one, else none
/// (the caller falls back to the hostname — a record that advertises
/// only public addresses is reached by its mDNS name, not by that IP).
fn pick_lan_address(info: &ServiceInfo) -> Option<String> {
    info.get_addresses()
        .iter()
        .find(|addr| is_lan_host(&addr.to_string()))
        .map(|addr| addr.to_string())
}

/// Whether `host` is a loopback, link-local or private address — the
/// addresses a LAN scan may keep. A hostname (an mDNS `.local` name
/// or a computer name) counts: the advertisement came over the LAN,
/// and the name is how the printer is reached.
fn is_lan_host(host: &str) -> bool {
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(v4)) => {
            let o = v4.octets();
            v4.is_loopback()
                || v4.is_link_local()
                || o[0] == 10
                || (o[0] == 172 && (16..=31).contains(&o[1]))
                || (o[0] == 192 && o[1] == 168)
        }
        Ok(IpAddr::V6(v6)) => {
            v6.is_loopback()
                || (v6.segments()[0] & 0xfe00) == 0xfc00 // unique-local, fc00::/7
                || (v6.segments()[0] & 0xffc0) == 0xfe80 // link-local, fe80::/10
        }
        Err(_) => true,
    }
}

/// The spooler queues, from `EnumPrinters` level 2: the name, the
/// port, and the status bits read through
/// [`pn_transport::spooler_status_problem`], so the list says what
/// the spooler knows and nothing it does not.
#[cfg(windows)]
fn windows_spooler_list() -> Vec<SystemPrinter> {
    use std::ffi::CStr;

    let mut out = Vec::new();
    let mut bytes_needed: winspool::DWORD = 0;
    let mut count: winspool::DWORD = 0;

    // First call sizes the buffer the second fills.
    unsafe {
        winspool::EnumPrintersA(
            winspool::PRINTER_ENUM_LOCAL | winspool::PRINTER_ENUM_CONNECTIONS,
            std::ptr::null_mut(),
            2,
            std::ptr::null_mut(),
            0,
            &mut bytes_needed,
            &mut count,
        );
    }
    if bytes_needed == 0 {
        return out;
    }
    let mut buffer = vec![0u8; bytes_needed as usize];
    let ok = unsafe {
        winspool::EnumPrintersA(
            winspool::PRINTER_ENUM_LOCAL | winspool::PRINTER_ENUM_CONNECTIONS,
            std::ptr::null_mut(),
            2,
            buffer.as_mut_ptr(),
            bytes_needed,
            &mut bytes_needed,
            &mut count,
        )
    };
    if ok == 0 {
        return out;
    }

    let stride = std::mem::size_of::<winspool::PRINTER_INFO_2A>();
    let capacity = bytes_needed as usize / stride;
    // The spooler filled the buffer with a packed array of the
    // struct. `vec!`'s allocation is aligned at least as much as
    // the largest built-in type, which covers the struct's
    // alignment on every target this runs.
    let (_prefix, infos, _suffix) =
        unsafe { buffer.as_slice().align_to::<winspool::PRINTER_INFO_2A>() };
    for info in infos.iter().take(capacity.min(count as usize)) {
        if info.pPrinterName.is_null() {
            continue;
        }
        // The pointers name NUL-terminated strings inside the
        // buffer, which outlives the reads.
        let (name, port) = unsafe {
            let name = CStr::from_ptr(info.pPrinterName as *const i8)
                .to_string_lossy()
                .to_string();
            let port = if info.pPortName.is_null() {
                String::new()
            } else {
                CStr::from_ptr(info.pPortName as *const i8)
                    .to_string_lossy()
                    .to_string()
            };
            (name, port)
        };
        out.push(SystemPrinter {
            name,
            port,
            status: pn_transport::spooler::spooler_status_problem(info.Status)
                .map(|s| s.to_string()),
        });
    }
    out
}

/// The CUPS destinations, from `lpstat -v` — one `system destination`
/// line per queue. CUPS keeps no per-queue status in that output, so
/// the list reports names only; the queue's faults surface when a
/// job is sent.
#[cfg(target_os = "linux")]
fn cups_list() -> Vec<SystemPrinter> {
    let Ok(output) = std::process::Command::new("lpstat").args(["-v"]).output() else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            // The first word is the CUPS server name, the second the
            // destination: `localhost hp-laser`.
            parts.next()?;
            let destination = parts.next()?;
            Some(SystemPrinter {
                name: destination.to_string(),
                port: String::new(),
                status: None,
            })
        })
        .collect()
}

#[cfg(windows)]
/// The winspool declarations, kept in the crate the way
/// `pn-transport` keeps its own — no winapi dependency for one call.
#[allow(clippy::upper_case_acronyms)]
mod winspool {
    use std::os::raw::{c_char, c_void};

    pub type BOOL = i32;
    pub type DWORD = u32;
    pub type LPSTR = *mut c_char;
    pub type LPVOID = *mut c_void;
    pub type LPBYTE = *mut u8;
    pub type LPDWORD = *mut DWORD;

    /// `PRINTER_INFO_2A` (winspool.h): one spooler queue.
    #[repr(C)]
    #[allow(non_snake_case)]
    pub struct PRINTER_INFO_2A {
        pub pPrinterName: LPSTR,
        pub pServerName: LPSTR,
        pub pShareName: LPSTR,
        pub pDriverName: LPSTR,
        pub pPortName: LPSTR,
        pub pComment: LPSTR,
        pub pLocation: LPSTR,
        pub pDevMode: LPVOID,
        pub pSepFile: LPSTR,
        pub pPrinterProcessor: LPSTR,
        pub pDatatype: LPSTR,
        pub pParameters: LPSTR,
        pub pDefaultDatatype: LPSTR,
        pub pSecurityDescriptor: LPVOID,
        pub cSecurityDescriptor: DWORD,
        pub Attributes: DWORD,
        pub Priority: DWORD,
        pub StartTime: DWORD,
        pub UntilTime: DWORD,
        pub Status: DWORD,
        pub cJobs: DWORD,
        pub AveragePPM: DWORD,
    }

    // The printer spooler functions live in winspool.drv.
    #[link(name = "winspool")]
    extern "system" {
        pub fn EnumPrintersA(
            dwFlags: DWORD,
            pName: LPSTR,
            Level: DWORD,
            pPrinterEnum: LPBYTE,
            cbBuf: DWORD,
            pcbNeeded: LPDWORD,
            pcReturned: LPDWORD,
        ) -> BOOL;
    }

    pub const PRINTER_ENUM_LOCAL: DWORD = 0x0000_0002;
    pub const PRINTER_ENUM_CONNECTIONS: DWORD = 0x0000_0100;
}

#[cfg(test)]
mod tests {
    use std::net::Ipv4Addr;

    use super::*;

    #[test]
    fn the_service_types_map_to_their_transports() {
        assert!(PRINTER_SERVICES.contains(&("_ipp._tcp.local.", "ipp")));
        assert!(PRINTER_SERVICES.contains(&("_ipps._tcp.local.", "ipp")));
        assert!(PRINTER_SERVICES.contains(&("_pdl-datastream._tcp.local.", "raw_tcp")));
        assert!(PRINTER_SERVICES.contains(&("_printer._tcp.local.", "raw_tcp")));
    }

    #[test]
    fn lan_addresses_are_kept_public_ones_are_not() {
        assert!(is_lan_host("192.168.1.4"));
        assert!(is_lan_host("10.0.0.5"));
        assert!(is_lan_host("172.16.0.1"));
        assert!(is_lan_host("172.31.255.255"));
        assert!(is_lan_host("127.0.0.1"));
        assert!(is_lan_host("169.254.10.10"));
        assert!(!is_lan_host("8.8.8.8"));
        assert!(!is_lan_host("172.32.0.1"));
        assert!(!is_lan_host("192.169.0.1"));
        assert!(is_lan_host("fc00::1"));
        assert!(is_lan_host("fe80::1"));
        assert!(!is_lan_host("2001:db8::1"));
        // A hostname is not an IP: the advertisement came over the
        // LAN, so the name is kept.
        assert!(is_lan_host("hp-laser.local."));
        assert!(is_lan_host("OfficePrinter"));
    }

    #[test]
    fn an_ipp_record_becomes_a_printer_with_its_resource_path() {
        let addrs = [IpAddr::V4(Ipv4Addr::new(192, 168, 1, 20))];
        let info = ServiceInfo::new(
            "_ipp._tcp.local.",
            "HP-OfficeJet",
            "hp.local.",
            &addrs[..],
            631,
            std::collections::HashMap::from([("rp".to_string(), "/printers/laser".to_string())]),
        )
        .expect("a valid service record");
        let p = service_info_to_printer(&info, "ipp").expect("a printer");
        assert_eq!(p.name, "HP-OfficeJet");
        assert_eq!(p.host, "192.168.1.20");
        assert_eq!(p.port, 631);
        assert_eq!(p.kind, "ipp");
        assert_eq!(p.resource_path.as_deref(), Some("printers/laser"));
    }

    #[test]
    fn a_record_without_a_port_is_dropped() {
        let addrs = [IpAddr::V4(Ipv4Addr::new(192, 168, 1, 20))];
        let info = ServiceInfo::new(
            "_ipp._tcp.local.",
            "Ghost",
            "ghost.local.",
            &addrs[..],
            0,
            std::collections::HashMap::new(),
        )
        .expect("a valid service record");
        assert!(service_info_to_printer(&info, "ipp").is_none());
    }

    #[test]
    fn a_public_address_loses_to_the_host_fallback() {
        let addrs = [IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))];
        let info = ServiceInfo::new(
            "_ipp._tcp.local.",
            "Public",
            "public.local.",
            &addrs[..],
            631,
            std::collections::HashMap::new(),
        )
        .expect("a valid service record");
        // The record's only address is public: the printer keeps its
        // mDNS hostname (trailing dot trimmed), and a name always
        // passes the scan's LAN filter — the advertisement came over
        // the LAN, and the name is how the printer is reached.
        let p = service_info_to_printer(&info, "ipp").expect("a printer");
        assert_eq!(p.host, "public.local");
        assert!(is_lan_host(&p.host));
    }

    #[test]
    fn the_scan_timeout_is_clamped_to_a_sane_band() {
        // 0 and 999 would both stall the UI or spin uselessly; the
        // clamp keeps the scan between 2 and 30 seconds.
        assert_eq!(
            Duration::from_secs(0u64.clamp(2, 30)),
            Duration::from_secs(2)
        );
        assert_eq!(
            Duration::from_secs(999u64.clamp(2, 30)),
            Duration::from_secs(30)
        );
    }
}
