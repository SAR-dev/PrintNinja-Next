//! ESC/POS raster wrapper: a byte-for-byte port of the old app's
//! `escpos.rs` defaults (the per-printer band-height tuning had no
//! profile field in the new schema, so the default 256-row bands are
//! what every profile gets).
//!
//! One job: `ESC @`, then per page — the raster as a run of `GS v 0`
//! bands (at most [`RASTER_BAND_ROWS`] rows each; short bands print
//! back to back as one image), a 3-line feed and a full cut. A
//! single-page job is the old app's `build_receipt` byte for byte.

use pn_render::Bitmap;
use pn_render::RasterPage;

/// Most rows one `GS v 0` command carries.
///
/// A whole page as one command is a bad bet on receipt printers: the
/// spec caps the height (Epson documents 2303 rows) and cheap
/// Bluetooth heads have a small receive buffer, so an oversized command
/// is dropped or ignored and nothing prints.
pub const RASTER_BAND_ROWS: usize = 256;

/// The image without its all-white bottom rows (at least one row is
/// kept). A receipt is printed on a continuous roll, so blank rows at
/// the end are only wasted paper and transfer time: a test page laid
/// out on an A4-tall canvas would otherwise send ~30 cm of nothing.
fn trim_trailing_blank_rows(dots: &[u8], width: u32, height: u32) -> Vec<u8> {
    let wb = Bitmap::bytes_per_row(width) as usize;
    let last_ink_row = dots.chunks(wb).rposition(|row| row.iter().any(|&b| b != 0));
    let keep = last_ink_row.map_or(1, |r| r + 1).min(height as usize);
    dots[..keep * wb].to_vec()
}

/// All the pages as one ESC/POS job.
pub(crate) fn raster(pages: &[RasterPage]) -> Vec<u8> {
    let mut out = vec![0x1B, 0x40]; // init
    for page in pages {
        let width = page.bitmap.width();
        let wb = Bitmap::bytes_per_row(width) as usize;
        let dots = trim_trailing_blank_rows(page.bitmap.to_bytes(), width, page.bitmap.height());
        for band in dots.chunks(wb * RASTER_BAND_ROWS) {
            let rows = band.len() / wb;
            out.extend_from_slice(&[
                0x1D,
                0x76,
                0x30,
                0x00, // GS v 0, mode: normal
                (wb & 0xFF) as u8,
                ((wb >> 8) & 0xFF) as u8,
                (rows & 0xFF) as u8,
                ((rows >> 8) & 0xFF) as u8,
            ]);
            out.extend_from_slice(band);
        }
        out.extend_from_slice(&[0x1B, 0x64, 0x03]); // feed 3 lines
        out.extend_from_slice(&[0x1D, 0x56, 0x00]); // full cut
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use pn_render::Renderer;

    /// The trailing feed and cut after every page.
    const TAIL: &[u8] = &[0x1B, 0x64, 0x03, 0x1D, 0x56, 0x00];

    fn page(w: u32, h: u32) -> RasterPage {
        RasterPage::new(Bitmap::new(w, h), 0.0, 0.0)
    }

    /// Walk the stream and return (the row counts of every `GS v 0`
    /// band, the bytes left after the last band).
    fn bands(bytes: &[u8], width_bytes: usize) -> (Vec<usize>, &[u8]) {
        let mut rows = Vec::new();
        let mut i = 2; // skip the init
        while i + 8 <= bytes.len() && bytes[i..i + 4] == [0x1D, 0x76, 0x30, 0x00] {
            let wb = bytes[i + 4] as usize | (bytes[i + 5] as usize) << 8;
            assert_eq!(wb, width_bytes, "band width must be the page width");
            let rows_n = bytes[i + 6] as usize | (bytes[i + 7] as usize) << 8;
            rows.push(rows_n);
            i += 8 + rows_n * width_bytes;
        }
        (rows, &bytes[i..])
    }

    #[test]
    fn a_tall_page_is_split_into_bands_that_cover_every_row() {
        // Ink in every row: nothing to trim, all 2374 rows must go out
        // in bands of at most RASTER_BAND_ROWS rows.
        let mut b = Bitmap::new(384, 2374);
        for y in 0..2374 {
            b.set(0, y, true);
        }
        let out = raster(&[RasterPage::new(b, 0.0, 0.0)]);
        let (rows, tail) = bands(&out, 48);
        assert!(rows.iter().all(|&r| r <= RASTER_BAND_ROWS));
        assert_eq!(rows.iter().sum::<usize>(), 2374);
        assert_eq!(tail, TAIL);
    }

    #[test]
    fn a_short_page_stays_one_command() {
        // Ink in both rows, so the trim keeps the whole 2-row image in
        // a single `GS v 0`.
        let mut b = Bitmap::new(16, 2);
        b.set(0, 1, true);
        let out = raster(&[RasterPage::new(b, 0.0, 0.0)]);
        let (rows, tail) = bands(&out, 2);
        assert_eq!(rows, vec![2]);
        assert_eq!(tail, TAIL);
    }

    #[test]
    fn the_tiny_known_page_is_exactly_the_old_apps_bytes() {
        // 16 x 2 dots with only the top-left set: the blank second row
        // is trimmed (the old app did the same), so the job is the old
        // app's build_receipt for this image — no drawer.
        let mut b = Bitmap::new(16, 2);
        b.set(0, 0, true);
        let out = raster(&[RasterPage::new(b, 0.0, 0.0)]);
        assert_eq!(
            out,
            vec![
                0x1B, 0x40, // init
                0x1D, 0x76, 0x30, 0x00, 0x02, 0x00, 0x01, 0x00, // GS v 0, one row
                0x80, 0x00, // the dots
                0x1B, 0x64, 0x03, // feed 3
                0x1D, 0x56, 0x00, // full cut
            ]
        );
    }

    #[test]
    fn a_blank_tail_is_trimmed_but_at_least_one_row_remains() {
        // Ink only near the top of a 384 x 400 canvas (20 mm at 203 dpi
        // is row ~157), so the ~240 blank rows below are trimmed away.
        let mut r = Renderer::new(203, 384, 400);
        r.draw_line(0.0, 20.0, 50.0, 0.5, false);
        let out = raster(&[RasterPage::new(r.into_page(), 58.0, 50.0)]);
        let (rows, tail) = bands(&out, 48);
        assert!(rows.iter().sum::<usize>() < 400);
        assert!(rows.iter().sum::<usize>() > 150);
        assert_eq!(tail, TAIL);

        // A fully blank page keeps one row rather than sending nothing.
        let out = raster(&[page(16, 50)]);
        let (rows, tail) = bands(&out, 2);
        assert_eq!(rows, vec![1]);
        assert_eq!(tail, TAIL);
    }

    #[test]
    fn a_batch_prints_every_page_in_order_with_its_own_cut() {
        let mut one = Renderer::new(203, 384, 80);
        one.draw_line(0.0, 10.0, 50.0, 0.5, false);
        let mut two = Renderer::new(203, 384, 80);
        two.draw_line(0.0, 70.0, 50.0, 0.5, false);
        let out = raster(&[
            RasterPage::new(one.into_page(), 58.0, 10.0),
            RasterPage::new(two.into_page(), 58.0, 10.0),
        ]);
        // Exactly one init, two feeds, two cuts.
        assert_eq!(out.windows(2).filter(|w| w == &[0x1B, 0x40]).count(), 1);
        assert_eq!(
            out.windows(3).filter(|w| w == &[0x1B, 0x64, 0x03]).count(),
            2
        );
        assert_eq!(
            out.windows(3).filter(|w| w == &[0x1D, 0x56, 0x00]).count(),
            2
        );
    }
}
