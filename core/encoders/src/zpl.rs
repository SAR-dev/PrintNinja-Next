//! ZPL label wrapper: a byte-for-byte port of the old app's
//! `label_langs.rs` ZPL path.
//!
//! One `^XA … ^XZ` per page — the whole label raster as a single
//! `^GFA` graphic, hex-encoded the way the old app sent it (Zebra
//! accepts hex; the old app chose it and it is what the hardware
//! sessions captured).

use pn_render::Bitmap;
use pn_render::RasterPage;

use crate::hex_upper;

/// All the pages, each as one ZPL label.
pub(crate) fn raster(pages: &[RasterPage]) -> Vec<u8> {
    let mut out = String::new();
    for page in pages {
        let w = page.bitmap.width();
        let h = page.bitmap.height();
        let bpr = Bitmap::bytes_per_row(w);
        let dots = page.bitmap.to_bytes();
        let total = bpr as usize * h as usize;
        out.push_str("^XA\n");
        out.push_str("^MMT\n");
        out.push_str(&format!("^PW{w}\n"));
        out.push_str(&format!("^LL{h}\n"));
        out.push_str("^LH0,0\n");
        out.push_str("^PR6\n");
        out.push_str(&format!("^FO0,0^GFA,{total},{total},{bpr},"));
        out.push_str(&hex_upper(dots));
        out.push_str("^FS\n^XZ\n");
    }
    out.into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(w: u32, h: u32) -> RasterPage {
        RasterPage::new(Bitmap::new(w, h), 0.0, 0.0)
    }

    /// 320 x 240 at 203 dpi (40 bytes/row, 9 600 bytes of dots): width,
    /// length and home are set, and the `^GFA` header matches the data.
    #[test]
    fn a_label_carries_width_length_home_and_matching_hex() {
        let zpl = String::from_utf8(raster(&[page(320, 240)])).unwrap();
        assert!(zpl.contains("^PW320\n"));
        assert!(zpl.contains("^LL240\n"));
        assert!(zpl.contains("^LH0,0\n"));
        assert!(zpl.contains("^PR6\n"));
        assert!(zpl.contains("^FO0,0^GFA,9600,9600,40,"));
        // 9 600 bytes of dots, hex-doubled, all zero for a blank label.
        let at = zpl.find("^FO0,0^GFA,9600,9600,40,").unwrap() + "^FO0,0^GFA,9600,9600,40,".len();
        let hex = &zpl[at..at + 19200];
        // uppercase hex, all zero for a blank label
        assert_eq!(hex, "0".repeat(19200));
        assert!(zpl.ends_with("^FS\n^XZ\n"));
    }

    /// Ink survives the hex round trip: a set dot is a high bit, MSB
    /// first, in the first byte of its row.
    #[test]
    fn a_set_dot_is_a_high_bit_in_the_hex() {
        let mut b = Bitmap::new(16, 2);
        b.set(0, 0, true);
        b.set(7, 1, true);
        let zpl = String::from_utf8(raster(&[RasterPage::new(b, 0.0, 0.0)])).unwrap();
        // 16 dots x 2 rows is 2 bytes per row: row 0 = 80 00 (dot 0 is the
        // MSB), row 1 = 01 00 (dot 7 is the low bit of the first byte)
        assert!(zpl.contains("^GFA,4,4,2,80000100"));
    }

    /// Two labels come out in order, each with its own `^XA`…`^XZ`.
    #[test]
    fn a_batch_prints_every_label_in_order() {
        let out = raster(&[page(100, 50), page(200, 60)]);
        let zpl = String::from_utf8(out).unwrap();
        assert_eq!(zpl.matches("^XA\n").count(), 2);
        assert_eq!(zpl.matches("^XZ\n").count(), 2);
        let first = zpl.find("^PW100").unwrap();
        let second = zpl.find("^PW200").unwrap();
        assert!(first < second);
    }
}
