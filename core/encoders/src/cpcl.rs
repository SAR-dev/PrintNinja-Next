//! CPCL label wrapper: a byte-for-byte port of the old app's
//! `label_langs.rs` CPCL path.
//!
//! One `! … PRINT` per page: the raster as a single `EG` (extended
//! graphics) command, hex-encoded like the old app's.

use pn_render::Bitmap;
use pn_render::RasterPage;

use crate::hex_upper;

/// All the pages, each as one CPCL label.
pub(crate) fn raster(pages: &[RasterPage]) -> Vec<u8> {
    let mut out = String::new();
    for page in pages {
        let h = page.bitmap.height();
        let bpr = Bitmap::bytes_per_row(page.bitmap.width());
        out.push_str(&format!("! 0 200 200 {h} 1\r\n"));
        out.push_str(&format!("EG {bpr} {h} 0 0 "));
        out.push_str(&hex_upper(page.bitmap.to_bytes()));
        out.push_str("\r\nPRINT\r\n");
    }
    out.into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(w: u32, h: u32) -> RasterPage {
        RasterPage::new(Bitmap::new(w, h), 0.0, 0.0)
    }

    /// 20 x 3: the `!` header carries the height, the `EG` header
    /// matches the data, and the hex is exactly the dotted bytes.
    #[test]
    fn the_graphic_header_matches_its_data() {
        let mut b = Bitmap::new(20, 3);
        b.set(0, 0, true); // first dot of row 0
        let cpcl = String::from_utf8(raster(&[RasterPage::new(b, 0.0, 0.0)])).unwrap();
        assert!(cpcl.starts_with("! 0 200 200 3 1\r\n"));
        // 20 dots = 3 bytes/row, 3 rows = 9 bytes = 18 hex digits:
        // row 0 = 0x80 (dot 0, MSB), rows 1-2 blank
        assert!(cpcl.contains("EG 3 3 0 0 800000000000000000\r\nPRINT\r\n"));
    }

    /// Two labels come out in order, each with its own `PRINT`.
    #[test]
    fn a_batch_prints_every_label_in_order() {
        let cpcl = String::from_utf8(raster(&[page(100, 50), page(200, 60)])).unwrap();
        assert_eq!(cpcl.matches("PRINT\r\n").count(), 2);
        let first = cpcl.find("! 0 200 200 50 1").unwrap();
        let second = cpcl.find("! 0 200 200 60 1").unwrap();
        assert!(first < second);
    }
}
