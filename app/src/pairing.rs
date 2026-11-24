//! Pairing for LAN exposure (plan phase 8, LAN increment).
//!
//! The PC opens a short-lived pairing window — a one-time 8-character
//! code shown on the settings screen — and a device on the network
//! claims it, receiving a per-device token. The code is the
//! introduction; the token is the credential. The code lives in
//! memory only, for the window's TTL; the token is shown once at
//! claim time, and the PC keeps only its SHA-256.

use rand::RngCore;
use std::time::{Duration, Instant};

/// 32 symbols, no `0 O 1 I` — a code is read off a screen by a person.
pub const ALPHABET: &[u8; 32] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/// The code's length.
pub const CODE_LEN: usize = 8;
/// How long one pairing window stays open.
pub const DEFAULT_TTL: Duration = Duration::from_secs(90);
/// How many wrong codes one window takes before it locks.
pub const MAX_WRONG_GUESSES: u8 = 5;

/// One open pairing window. Single use, one window at a time, held in
/// memory by the API's state.
#[derive(Debug, Clone)]
pub struct PairingWindow {
    code: String,
    opened: Instant,
    ttl: Duration,
    wrong: u8,
    claimed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClaimError {
    /// The window is gone — expired, claimed, or locked.
    Unavailable,
    /// A wrong code; how many tries the window still takes.
    Wrong { left: u8 },
    /// The code is not the shape a code has.
    BadFormat,
}

impl PairingWindow {
    /// A fresh window on the built-in TTL.
    pub fn new(code: String) -> Self {
        PairingWindow {
            code,
            opened: Instant::now(),
            ttl: DEFAULT_TTL,
            wrong: 0,
            claimed: false,
        }
    }

    /// A window with the clock and the TTL held: the tests drive time.
    #[cfg(test)]
    pub(crate) fn at(code: String, opened: Instant, ttl: Duration) -> Self {
        PairingWindow {
            code,
            opened,
            ttl,
            wrong: 0,
            claimed: false,
        }
    }

    pub fn is_open(&self, now: Instant) -> bool {
        !self.claimed && !self.is_locked() && now.duration_since(self.opened) < self.ttl
    }

    fn is_locked(&self) -> bool {
        self.wrong >= MAX_WRONG_GUESSES
    }

    /// Check a presented code. A successful claim uses the window up.
    pub fn claim(&mut self, presented: &str, now: Instant) -> Result<(), ClaimError> {
        if self.claimed || self.is_locked() {
            return Err(ClaimError::Unavailable);
        }
        if now.duration_since(self.opened) >= self.ttl {
            return Err(ClaimError::Unavailable);
        }
        let normalized = normalize_code(presented);
        if !valid_format(&normalized) {
            return Err(ClaimError::BadFormat);
        }
        if !constant_time_eq(&normalized, &self.code) {
            self.wrong += 1;
            if self.is_locked() {
                return Err(ClaimError::Unavailable);
            }
            return Err(ClaimError::Wrong {
                left: MAX_WRONG_GUESSES - self.wrong,
            });
        }
        self.claimed = true;
        Ok(())
    }
}

/// Uppercase, strip whitespace. Dashes are neither stripped nor
/// accepted: codes are dashless, so a dash is a format error.
pub fn normalize_code(raw: &str) -> String {
    raw.to_ascii_uppercase()
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect()
}

/// `CODE_LEN` characters, all from the alphabet.
pub fn valid_format(code: &str) -> bool {
    code.len() == CODE_LEN && code.bytes().all(|b| ALPHABET.contains(&b))
}

/// Mint an 8-character code from `OsRng`. Each byte contributes its
/// low 5 bits — 256 divides 32 evenly, so the mask is unbiased.
pub fn generate_code() -> String {
    let mut bytes = [0u8; CODE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes
        .iter()
        .map(|b| ALPHABET[(b & 31) as usize] as char)
        .collect()
}

/// A per-device token, shown once at claim time.
pub fn mint_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes
        .iter()
        .map(|b| ALPHABET[(b & 31) as usize] as char)
        .collect()
}

/// `sha256(token)` hex. What the paired-devices row holds — the token
/// itself is never written to disk.
pub fn token_hash(token: &str) -> String {
    use sha2::Digest as _;
    format!("{:x}", sha2::Sha256::digest(token.as_bytes()))
}

/// Compare without an early exit.
fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_and_tokens_use_only_the_alphabet() {
        for _ in 0..200 {
            for s in [generate_code(), mint_token()] {
                assert!(s.bytes().all(|b| ALPHABET.contains(&b)), "{s}");
            }
        }
        assert_eq!(generate_code().len(), 8);
        assert_eq!(mint_token().len(), 32);
    }

    #[test]
    fn normalization_strips_spaces_but_rejects_dashes() {
        assert_eq!(normalize_code("k7qm 4xpd"), "K7QM4XPD");
        assert!(!valid_format(&normalize_code("k7qm-4xpd")));
    }

    #[test]
    fn a_claim_uses_the_window_up() {
        let start = Instant::now();
        let mut w = PairingWindow::at("K7QM4XPD".into(), start, DEFAULT_TTL);
        assert!(w.claim("k7qm4xpd", start).is_ok());
        assert_eq!(w.claim("K7QM4XPD", start), Err(ClaimError::Unavailable));
    }

    #[test]
    fn the_ttl_is_honoured() {
        let start = Instant::now();
        let mut w = PairingWindow::at("K7QM4XPD".into(), start, Duration::from_secs(90));
        assert!(w.claim("K7QM4XPD", start + Duration::from_secs(89)).is_ok());
        let mut w = PairingWindow::at("K7QM4XPD".into(), start, Duration::from_secs(90));
        assert_eq!(
            w.claim("K7QM4XPD", start + Duration::from_secs(90)),
            Err(ClaimError::Unavailable)
        );
    }

    #[test]
    fn wrong_guesses_count_and_lock() {
        let start = Instant::now();
        let mut w = PairingWindow::at("K7QM4XPD".into(), start, DEFAULT_TTL);
        for i in 1..MAX_WRONG_GUESSES {
            assert_eq!(
                w.claim("AAAAAAAA", start),
                Err(ClaimError::Wrong {
                    left: MAX_WRONG_GUESSES - i
                })
            );
        }
        assert_eq!(w.claim("AAAAAAAA", start), Err(ClaimError::Unavailable));
        assert_eq!(w.claim("K7QM4XPD", start), Err(ClaimError::Unavailable));
    }

    #[test]
    fn a_bad_format_is_its_own_error() {
        let start = Instant::now();
        let mut w = PairingWindow::at("K7QM4XPD".into(), start, DEFAULT_TTL);
        assert_eq!(w.claim("short", start), Err(ClaimError::BadFormat));
    }

    #[test]
    fn a_token_hash_is_stable_sha256_hex() {
        assert_eq!(
            token_hash("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
