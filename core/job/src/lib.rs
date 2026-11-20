//! Job model: states, verification, retry, partial counts
//! (plan §5.7, built in phase 3).
//!
//! Result states are honest about what was actually confirmed:
//! `Printed (confirmed)` only when the printer acknowledged;
//! `Sent (unconfirmed)` for spooler-accepted jobs; `Failed (with reason)`
//! for anything else, with the spooler's cause attached.
