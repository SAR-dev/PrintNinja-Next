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
//! millimetres-to-dots geometry ([`dots_for_mm`], [`fit_to_head`]) and
//! line/rectangle drawing ([`Renderer`]).

mod bitmap;
mod draw;
mod geometry;

pub use bitmap::Bitmap;
pub use draw::Renderer;
pub use geometry::{dots_for_mm, fit_to_head};

#[cfg(test)]
mod tests {
    use super::*;

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
}
