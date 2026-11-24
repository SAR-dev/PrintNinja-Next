//! Deep links (plan phase 8, deep-link increment).
//!
//! `printninja://print?template=&printer=&copies=&dataUrl=` — a web
//! page asks the app to print. The link is prefill-only: the values
//! land on the print screen, where the person sees what will print and
//! presses Print. That press is the confirmation for untrusted
//! sources, and it applies to every source, because a link does not
//! carry the caller's identity. `dataUrl` (the old app's `url`) names
//! a data URL: the print screen fetches the job's data from it on
//! preview and on print.
//!
//! The conventions are the old app's (its `deeplink.rs` is the
//! behavior reference): a typed value that is garbage or absent
//! stays unset (a bad `copies` means "no copies given", never an
//! error), `+` in a query is a space, and an invalid percent
//! sequence is kept verbatim.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// The values a `printninja://print` link carries. Every field is
/// optional — a link may name only a template, or only a printer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeepLinkPrint {
    /// The template, by the name the app shows it.
    pub template: Option<String>,
    /// The printer, by the profile's model name.
    pub printer: Option<String>,
    /// How many copies; garbage or an absent key is `None`.
    pub copies: Option<u32>,
    /// The data URL: the job's data is fetched from it (the old app's
    /// `url` key is read too, so its links still work).
    pub data_url: Option<String>,
}

/// Parse a delivered deep link URL into the print values.
pub fn parse_deep_link(url: &str) -> Result<DeepLinkPrint, String> {
    let url = url.strip_prefix("printninja://").unwrap_or(url);
    let (path, query) = if let Some(idx) = url.find('?') {
        (&url[..idx], &url[idx + 1..])
    } else {
        (url, "")
    };
    if path != "print" {
        return Err(format!("unknown deep link action: {path}"));
    }
    let params = parse_query_params(query);
    Ok(DeepLinkPrint {
        template: params
            .get("template")
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        printer: params
            .get("printer")
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        // The deep-link convention for typed values: garbage drops
        // to "unset", like an absent key.
        copies: params.get("copies").and_then(|s| s.parse().ok()),
        data_url: params
            .get("dataUrl")
            .or_else(|| params.get("url"))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
    })
}

fn parse_query_params(query: &str) -> HashMap<String, String> {
    let mut params = HashMap::new();
    for pair in query.split('&') {
        if let Some((key, value)) = pair.split_once('=') {
            params.insert(percent_decode(key), percent_decode(value));
        }
    }
    params
}

/// Query strings encode a space as `+`, not `%20`. Invalid percent
/// sequences are kept verbatim — a decoder that drops them would
/// mangle a legitimate `100%` in a template name. The `urlencoding`
/// crate is the same decoder the old app used.
fn percent_decode(s: &str) -> String {
    let plus_as_space = s.replace('+', " ");
    urlencoding::decode(&plus_as_space)
        .map(|cow| cow.into_owned())
        .unwrap_or(plus_as_space)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_decode_handles_plus_as_space() {
        assert_eq!(percent_decode("My+Receipt"), "My Receipt");
        assert_eq!(percent_decode("a+b+c"), "a b c");
        assert_eq!(percent_decode("hello+world"), "hello world");
    }

    #[test]
    fn percent_decode_handles_percent_encoding() {
        assert_eq!(percent_decode("hello%20world"), "hello world");
        assert_eq!(percent_decode("%2F"), "/");
        assert_eq!(percent_decode("a%2Bb"), "a+b");
    }

    #[test]
    fn percent_decode_handles_mixed_plus_and_percent() {
        // `+` becomes space before percent-decoding, so `%2B` stays `+`.
        assert_eq!(percent_decode("My+Receipt%20v2"), "My Receipt v2");
    }

    #[test]
    fn percent_decode_preserves_invalid_percent() {
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("a%2"), "a%2");
        assert_eq!(percent_decode("a%ZZ"), "a%ZZ");
    }

    #[test]
    fn a_print_link_carrying_everything() {
        let p = parse_deep_link("printninja://print?template=Parts%20label&printer=Desk&copies=3")
            .unwrap();
        assert_eq!(p.template.as_deref(), Some("Parts label"));
        assert_eq!(p.printer.as_deref(), Some("Desk"));
        assert_eq!(p.copies, Some(3));
    }

    #[test]
    fn a_plus_decodes_like_a_space() {
        let p = parse_deep_link("printninja://print?template=My+Receipt").unwrap();
        assert_eq!(p.template.as_deref(), Some("My Receipt"));
    }

    #[test]
    fn a_bare_link_is_just_a_print_with_nothing_set() {
        let p = parse_deep_link("printninja://print").unwrap();
        assert_eq!(
            p,
            DeepLinkPrint {
                template: None,
                printer: None,
                copies: None,
                data_url: None
            }
        );
    }

    #[test]
    fn garbage_copies_drop_to_unset() {
        for raw in ["lots", "-3", "99999999999", ""] {
            let p = parse_deep_link(&format!("printninja://print?copies={raw}")).unwrap();
            assert_eq!(p.copies, None, "copies={raw:?} must drop");
        }
    }

    #[test]
    fn an_empty_value_is_absent_not_empty() {
        let p = parse_deep_link("printninja://print?template=").unwrap();
        assert_eq!(p.template, None);
    }

    #[test]
    fn a_data_url_link_prefills_the_data_source() {
        let p = parse_deep_link(
            "printninja://print?template=Parts%20label&dataUrl=https%3A%2F%2Fprinter.example%2Fdata.json",
        )
        .unwrap();
        assert_eq!(p.template.as_deref(), Some("Parts label"));
        assert_eq!(
            p.data_url.as_deref(),
            Some("https://printer.example/data.json")
        );
    }

    #[test]
    fn the_old_apps_url_key_still_works() {
        let p =
            parse_deep_link("printninja://print?url=https://printer.example/data.json").unwrap();
        assert_eq!(
            p.data_url.as_deref(),
            Some("https://printer.example/data.json")
        );
    }

    #[test]
    fn an_empty_data_url_is_absent() {
        let p = parse_deep_link("printninja://print?dataUrl=").unwrap();
        assert_eq!(p.data_url, None);
    }

    #[test]
    fn an_unknown_action_is_an_error() {
        assert!(parse_deep_link("printninja://explode/now").is_err());
        assert!(parse_deep_link("printninja://open/history").is_err());
    }
}
