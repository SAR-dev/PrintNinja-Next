//! Transports: Bluetooth, USB, TCP, and the OS print path (plan §5.6,
//! built in phase 3).
//!
//! The OS print path delivers a PDF to a system printer; its result is
//! spooler-level only — a job ends in `Sent (unconfirmed)` or
//! `Failed (with reason)`, never `Printed (confirmed)` (plan §5.7).
