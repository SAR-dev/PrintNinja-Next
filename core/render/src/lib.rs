//! Rust renderer: 1-bit bitmaps at the printer's dpi, plus — in later
//! phase-5 increments — text shaping, barcodes/QR and PDF output
//! (plan §5.2). One renderer drives every thermal path and the PDF
//! path for `page` media.
//!
//! The renderer is deterministic: the same placed shapes at the same
//! dpi give the same bytes on every platform, which is what makes the
//! golden snapshot tests meaningful (plan §5.2).
//!
//! This increment: the page model ([`Bitmap`]), the
//! millimetres-to-dots geometry ([`dots_for_mm`], [`fit_to_head`]),
//! line/rectangle drawing, text shaping with font fallback and
//! barcode/QR symbols ([`Renderer`]).

mod barcode;
mod bitmap;
mod draw;
pub mod fonts;
mod geometry;
mod text;

pub use bitmap::Bitmap;
pub use draw::Renderer;
pub use fonts::FontSet;
pub use geometry::{dots_for_mm, fit_to_head};

#[cfg(test)]
mod tests {
    use super::*;
    use pn_scene::Align;
    use pn_scene::TextStyle;

    /// A label with text renders to the pinned bytes: the same 24 × 10
    /// mm page as above, with a 2 mm heading, a 1.5 mm line and a
    /// 2 mm Japanese price — Japanese included, because the fallback
    /// chain carries it.
    #[test]
    fn the_text_label_matches_the_pinned_golden_bytes() {
        let dpi = 203u32;
        let w = fit_to_head(dots_for_mm(24.0, dpi), Some(384));
        let h = dots_for_mm(10.0, dpi);
        let mut r = Renderer::new(dpi, w, h);
        r.draw_text(
            2.0,
            1.5,
            20.0,
            3.0,
            "PRINT NINJA",
            &TextStyle {
                size_mm: 2.5,
                font: None,
                bold: true,
                italic: false,
                align: Align::Left,
            },
        );
        r.draw_text(
            2.0,
            5.0,
            12.0,
            3.0,
            "¥1,200",
            &TextStyle {
                size_mm: 1.5,
                font: None,
                bold: false,
                italic: false,
                align: Align::Right,
            },
        );
        r.draw_text(
            15.0,
            5.0,
            7.0,
            3.0,
            "本体",
            &TextStyle {
                size_mm: 2.0,
                font: None,
                bold: false,
                italic: false,
                align: Align::Center,
            },
        );
        golden_harness::assert_matches_golden("render/label-text.bin", r.page().to_bytes());
    }

    /// The Japanese-only line is pinned on its own: the fallback
    /// chain's bytes must be stable across platforms, not just present.
    #[test]
    fn the_japanese_line_matches_the_pinned_golden_bytes() {
        let dpi = 203u32;
        let mut r = Renderer::new(dpi, dots_for_mm(40.0, dpi), dots_for_mm(6.0, dpi));
        r.draw_text(
            0.0,
            0.0,
            40.0,
            6.0,
            "プリント忍者 合格",
            &TextStyle {
                size_mm: 3.0,
                font: None,
                bold: false,
                italic: false,
                align: Align::Left,
            },
        );
        golden_harness::assert_matches_golden("render/text-japanese.bin", r.page().to_bytes());
    }

    /// A small label drawn in millimetres renders to the pinned bytes:
    /// 24 × 10 mm at 203 dpi is 192 × 80 dots (2 400 packed bytes),
    /// holding a 0.5 mm frame around a 20 × 6 mm rect, a horizontal
    /// rule and a vertical divider.
    #[test]
    fn the_label_page_matches_the_pinned_golden_bytes() {
        let dpi = 203u32;
        let w = fit_to_head(dots_for_mm(24.0, dpi), Some(384));
        let h = dots_for_mm(10.0, dpi);
        let mut r = Renderer::new(dpi, w, h);
        r.draw_rect(2.0, 2.0, 20.0, 6.0, 0.5, false);
        r.draw_line(4.0, 5.0, 16.0, 0.25, false);
        r.draw_line(14.0, 2.5, 5.0, 0.25, true);
        golden_harness::assert_matches_golden("render/label-line-rect.bin", r.page().to_bytes());
    }

    /// A Code 128 with its human-readable line is pinned: the module
    /// pattern, the quiet zones and the text band must be stable across
    /// platforms.
    #[test]
    fn the_barcode_label_matches_the_pinned_golden_bytes() {
        let dpi = 203u32;
        let mut r = Renderer::new(dpi, dots_for_mm(56.0, dpi), dots_for_mm(15.0, dpi));
        r.draw_barcode(
            3.0,
            3.0,
            50.0,
            9.0,
            &pn_scene::BarcodeKind::Code128,
            "SN-1042-88",
            true,
        );
        golden_harness::assert_matches_golden("render/barcode-code128.bin", r.page().to_bytes());
    }

    /// A QR code is pinned on its own: the matrix plus its 4-module
    /// quiet zone is the whole picture.
    #[test]
    fn the_qr_code_matches_the_pinned_golden_bytes() {
        let dpi = 203u32;
        let mut r = Renderer::new(dpi, dots_for_mm(30.0, dpi), dots_for_mm(30.0, dpi));
        r.draw_qr(2.0, 2.0, 24.0, "https://example.com/o/1042");
        golden_harness::assert_matches_golden("render/qr.bin", r.page().to_bytes());
    }
}
