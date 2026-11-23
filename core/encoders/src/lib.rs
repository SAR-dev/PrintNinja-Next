//! Byte encoders (plan §5.5): the thin image wrappers that turn the
//! raster pages `pn-render` produces into the byte stream the
//! printer's language accepts — one 1-bit bitmap per page/label.
//!
//! One entry point — [`raster`] — dispatches on the profile's
//! language. The four thermal wrappers (ESC/POS, ZPL, TSPL, CPCL) are
//! byte-for-byte ports of the old app's default output; a document
//! printer (`language = "pdf"`) has no raster path — its bytes are the
//! PDF itself ([`pn_render::render_pdf`]). The `native()` encoders
//! (printer-generated fonts and barcodes) join in phase 6.
//!
//! The output is deterministic, and its bytes are pinned by
//! golden-file tests (`tests/golden`).

mod cpcl;
mod escpos;
mod tspl;
mod zpl;

use pn_profiles::Language;
use pn_profiles::Profile;
use pn_render::RasterPage;
use thiserror::Error;

/// What can go wrong wrapping pages in a language.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum EncoderError {
    /// A `language = "pdf"` printer prints through the OS print path
    /// (spooler or IPP), not raster commands.
    #[error("a document printer has no raster path — page media goes through the OS print path")]
    NoRasterPath,
}

/// The rendered pages as one job in the profile's language.
///
/// # Panics
/// An empty page list, or a page without size or dots, is a bug in the
/// caller — the planner guarantees at least one rendered page.
pub fn raster(pages: &[RasterPage], profile: &Profile) -> Result<Vec<u8>, EncoderError> {
    assert!(!pages.is_empty(), "a job has at least one page");
    for (i, p) in pages.iter().enumerate() {
        assert!(
            p.width_mm > 0.0 && p.height_mm > 0.0,
            "page {i} has no size"
        );
        assert!(
            p.bitmap.width() > 0 && p.bitmap.height() > 0,
            "page {i} has no dots"
        );
    }
    match profile.profile.language {
        Language::Escpos => Ok(escpos::raster(pages)),
        Language::Zpl => Ok(zpl::raster(pages)),
        Language::Tspl => Ok(tspl::raster(pages, profile)),
        Language::Cpcl => Ok(cpcl::raster(pages)),
        Language::Pdf => Err(EncoderError::NoRasterPath),
    }
}

/// Dots as uppercase hex — ZPL `^GFA` and CPCL `EG` both carry the
/// raster this way (the old app's choice, kept).
pub(crate) fn hex_upper(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789ABCDEF";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(DIGITS[(b >> 4) as usize] as char);
        s.push(DIGITS[(b & 0x0F) as usize] as char);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use pn_render::{dots_for_mm, Renderer};
    use std::fs;

    /// A real shipped profile, parsed from its TOML.
    fn profile(name: &str) -> Profile {
        let path = format!(
            "{}/../profiles/profiles/{name}.toml",
            env!("CARGO_MANIFEST_DIR")
        );
        pn_profiles::parse(&fs::read_to_string(path).unwrap()).unwrap()
    }

    /// A page drawn at the profile's own dpi and head width: the
    /// encoder's golden input is rendered by the same renderer that
    /// production uses.
    fn page_for(profile: &Profile, h_mm: f32, draw: impl FnOnce(&mut Renderer)) -> RasterPage {
        let meta = &profile.profile;
        let dpi = meta.dpi.unwrap() as u32;
        let w = meta.head_width_dots.unwrap();
        let w_mm = w as f64 * 25.4 / dpi as f64;
        let mut r = Renderer::new(dpi, w, dots_for_mm(h_mm, dpi));
        draw(&mut r);
        RasterPage::new(r.into_page(), w_mm as f32, h_mm)
    }

    /// A two-page A4 document for the document printer: the profile's
    /// language says "pdf", so there is no raster path.
    #[test]
    fn a_document_printer_has_no_raster_path() {
        let profile = profile("office-laser-cups");
        let r = Renderer::new(300, dots_for_mm(210.0, 300), dots_for_mm(297.0, 300));
        let page = RasterPage::new(r.into_page(), 210.0, 297.0);
        let err = raster(&[page], &profile).unwrap_err();
        assert_eq!(err, EncoderError::NoRasterPath);
    }

    /// A receipt on the generic 58 mm thermal: the bytes the old app
    /// would have sent to the same printer, pinned.
    #[test]
    fn the_escpos_receipt_matches_the_pinned_golden_bytes() {
        let profile = profile("generic-thermal-58mm");
        let page = page_for(&profile, 40.0, |r| {
            r.draw_text(
                3.0,
                3.0,
                50.0,
                6.0,
                "PRINT NINJA",
                &pn_scene::TextStyle {
                    size_mm: 3.0,
                    font: None,
                    bold: true,
                    italic: false,
                    align: pn_scene::Align::Center,
                },
            );
            r.draw_line(3.0, 12.0, 52.0, 0.3, false);
            r.draw_text(
                3.0,
                16.0,
                50.0,
                5.0,
                "¥1,200 本体",
                &pn_scene::TextStyle {
                    size_mm: 2.0,
                    font: None,
                    bold: false,
                    italic: false,
                    align: pn_scene::Align::Right,
                },
            );
        });
        golden_harness::assert_matches_golden(
            "encoders/escpos-receipt.bin",
            &raster(&[page], &profile).unwrap(),
        );
    }

    /// A Code 128 label on the GK420d: pinned, hex included.
    #[test]
    fn the_zpl_label_matches_the_pinned_golden_bytes() {
        let profile = profile("gk420d");
        let page = page_for(&profile, 40.0, |r| {
            r.draw_barcode(
                10.0,
                8.0,
                80.0,
                14.0,
                &pn_scene::BarcodeKind::Code128,
                "SN-1042-88",
                true,
            );
            r.draw_text(
                10.0,
                28.0,
                80.0,
                5.0,
                "プリント忍者",
                &pn_scene::TextStyle {
                    size_mm: 3.0,
                    font: None,
                    bold: false,
                    italic: false,
                    align: pn_scene::Align::Left,
                },
            );
        });
        golden_harness::assert_matches_golden(
            "encoders/zpl-label.bin",
            &raster(&[page], &profile).unwrap(),
        );
    }

    /// A two-line label on the TTP-244 Pro, gap 2.0 mm: pinned, raw
    /// binary included.
    #[test]
    fn the_tspl_label_matches_the_pinned_golden_bytes() {
        let profile = profile("ttp-244-pro");
        let page = page_for(&profile, 40.0, |r| {
            r.draw_text(
                5.0,
                5.0,
                48.0,
                8.0,
                "SN-1042-88",
                &pn_scene::TextStyle {
                    size_mm: 3.0,
                    font: None,
                    bold: true,
                    italic: false,
                    align: pn_scene::Align::Center,
                },
            );
            r.draw_rect(3.0, 3.0, 52.0, 34.0, 0.5, false);
        });
        golden_harness::assert_matches_golden(
            "encoders/tspl-label.bin",
            &raster(&[page], &profile).unwrap(),
        );
    }

    /// A QR label on the CT-S500 at its own 200 dpi: pinned.
    #[test]
    fn the_cpcl_label_matches_the_pinned_golden_bytes() {
        let profile = profile("ct-s500");
        let page = page_for(&profile, 50.0, |r| {
            r.draw_qr(5.0, 5.0, 40.0, "https://example.com/o/1042");
        });
        golden_harness::assert_matches_golden(
            "encoders/cpcl-label.bin",
            &raster(&[page], &profile).unwrap(),
        );
    }
}
