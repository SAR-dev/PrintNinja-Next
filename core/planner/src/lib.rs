//! Print planner: picks the execution path for a job (plan §5.1,
//! built in phase 6).
//!
//! Path routing: `format` + media kind first, then path —
//! native commands (ESC/POS, ZPL, TSPL, CPCL) → raster (1-bit) → PDF via
//! the OS print path. The planner never emits bytes; encoders do.
