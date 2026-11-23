//! TSPL label wrapper: a byte-for-byte port of the old app's
//! `label_langs.rs` TSPL path at its defaults (no density, no speed —
//! those per-roll tunings had no profile field in the new schema).
//!
//! One job per page: `SIZE`, `GAP` (the profile's `min_gap_dots` in
//! millimetres, or 0 for continuous media — the old app's media
//! switch), `DIRECTION 1`, `CLS`, then the raster as a raw
//! `BITMAP` command and `PRINT 1`.

use pn_profiles::{Media, Profile};
use pn_render::Bitmap;
use pn_render::RasterPage;

/// All the pages, each as one TSPL label.
pub(crate) fn raster(pages: &[RasterPage], profile: &Profile) -> Vec<u8> {
    let gap = gap_mm(profile);
    let mut out = Vec::new();
    for page in pages {
        let h = page.bitmap.height();
        let bpr = Bitmap::bytes_per_row(page.bitmap.width());
        let mut head = String::new();
        head.push_str(&format!(
            "SIZE {} mm,{} mm\r\n",
            page.width_mm, page.height_mm
        ));
        head.push_str(&format!("GAP {gap} mm,0 mm\r\n"));
        head.push_str("DIRECTION 1\r\n");
        head.push_str("REFERENCE 0,0\r\n");
        head.push_str("CLS\r\n");
        head.push_str(&format!("BITMAP 0,0,{bpr},{h},0\r\n"));
        out.extend_from_slice(head.as_bytes());
        out.extend_from_slice(page.bitmap.to_bytes());
        out.extend_from_slice(b"\r\nPRINT 1\r\n");
    }
    out
}

/// The gap in millimetres, from the profile's `min_gap_dots` (one decimal
/// place, the way the old app's gap setting was stored). 0.0 when the
/// printer has no labels, or the profile is missing the gap or dpi —
/// the old app's continuous-media default.
fn gap_mm(profile: &Profile) -> String {
    let m = &profile.profile;
    if m.media.contains(&Media::Label) {
        if let (Some(gap), Some(dpi)) = (m.min_gap_dots, m.dpi) {
            return format!("{:.1}", gap as f64 * 25.4 / dpi as f64);
        }
    }
    "0.0".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(media: &str, min_gap_dots: Option<u32>) -> Profile {
        let toml = format!(
            "[profile]\nmodel = \"T\"\nlanguage = \"tspl\"\ndpi = 203\n\
             head_width_dots = 812\nmedia = [\"{media}\"]\n{}\n",
            min_gap_dots
                .map(|g| format!("min_gap_dots = {g}\n"))
                .unwrap_or_default()
        );
        pn_profiles::parse(&toml).unwrap()
    }

    fn page(w: u32, h: u32, w_mm: f32, h_mm: f32) -> RasterPage {
        RasterPage::new(Bitmap::new(w, h), w_mm, h_mm)
    }

    /// A label profile carries its gap in millimetres: 16 dots at 203
    /// dpi is 2.0 mm.
    #[test]
    fn a_label_profile_carries_its_gap_in_millimetres() {
        let out = raster(&[page(80, 60, 40.0, 30.0)], &profile("label", Some(16)));
        let tspl = String::from_utf8_lossy(&out);
        assert!(tspl.starts_with("SIZE 40 mm,30 mm\r\n"));
        assert!(tspl.contains("GAP 2.0 mm,0 mm\r\n"));
        assert!(tspl.contains("DIRECTION 1\r\n"));
        assert!(tspl.contains("REFERENCE 0,0\r\n"));
        assert!(tspl.contains("CLS\r\n"));
        assert!(tspl.ends_with("\r\nPRINT 1\r\n"));
    }

    /// Continuous media (or a missing gap) prints with a zero gap.
    #[test]
    fn continuous_media_gets_a_zero_gap() {
        for (media, gap) in [("continuous", None), ("label", None)] {
            let out = raster(&[page(80, 60, 40.0, 30.0)], &profile(media, gap));
            assert!(
                String::from_utf8_lossy(&out).contains("GAP 0.0 mm,0 mm\r\n"),
                "{media} without a gap must print GAP 0"
            );
        }
    }

    /// The `BITMAP` header matches the raw dots that follow: 32 x 4 is
    /// 4 bytes x 4 rows = 16 bytes of binary after the header.
    #[test]
    fn the_bitmap_header_matches_its_raw_dots() {
        let mut b = Bitmap::new(32, 4);
        b.set(0, 0, true);
        b.set(31, 3, true);
        let out = raster(
            &[RasterPage::new(b, 40.0, 30.0)],
            &profile("label", Some(16)),
        );
        let at = out
            .windows(b"BITMAP 0,0,4,4,0\r\n".len())
            .position(|w| w == b"BITMAP 0,0,4,4,0\r\n")
            .unwrap();
        let dots = &out[at + 18..at + 18 + 16];
        assert_eq!(dots[0], 0x80); // first dot of row 0, MSB first
        assert_eq!(dots[15], 0x01); // last dot of row 3
        assert_eq!(&out[at + 18 + 16..], b"\r\nPRINT 1\r\n");
    }

    /// Two labels come out in order, each with its own `PRINT 1`.
    #[test]
    fn a_batch_prints_every_label_in_order() {
        let out = raster(
            &[page(80, 60, 40.0, 30.0), page(80, 100, 40.0, 50.0)],
            &profile("label", Some(16)),
        );
        let tspl = String::from_utf8_lossy(&out);
        assert_eq!(tspl.matches("PRINT 1\r\n").count(), 2);
        let first = tspl.find("SIZE 40 mm,30 mm").unwrap();
        let second = tspl.find("SIZE 40 mm,50 mm").unwrap();
        assert!(first < second);
    }
}
