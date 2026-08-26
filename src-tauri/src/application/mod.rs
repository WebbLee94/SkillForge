//! Application layer — use cases that orchestrate domain logic with
//! infrastructure access (DB / filesystem / platform plugins).
//!
//! Use cases here own orchestration and IO coordination; pure decision logic
//! belongs to `domain`, thin compatibility surfaces stay in `engine`.

pub mod distribution;
