//! Byte encoders: one module per printer language (ESC/POS, ZPL, TSPL,
//! CPCL) (plan §5.1, built in phase 6).
//!
//! Each encoder turns a render product (raster page, or label/field data)
//! into the byte stream a printer of that language accepts. Golden-file
//! tests (`tests/golden`) pin their output.
