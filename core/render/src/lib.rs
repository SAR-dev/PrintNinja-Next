//! Rust renderer: text shaping, bitmap (1-bit) output, PDF output
//! (plan §5.1, built in phase 5).
//!
//! Consumes a scene plus a media description and produces either raster
//! pages or a PDF. The renderer is the biggest single risk in the plan —
//! text shaping quality decides it.
