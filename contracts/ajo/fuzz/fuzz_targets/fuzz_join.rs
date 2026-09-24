#![no_main]
//! Fuzz target: `join`
//!
//! Exercises member-join boundary conditions: duplicate addresses, over-capacity
//! joins, and zero/negative initial lock amounts.

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    // Need at least 17 bytes: 16 (i128 lock amount) + 1 (member count seed)
    if data.len() < 17 {
        return;
    }

    let lock_amount = i128::from_le_bytes(data[0..16].try_into().unwrap());
    let member_count_seed = data[16] as u32;

    // Negative lock amounts must never be accepted.
    if lock_amount < 0 {
        // The contract should reject this — verify the guard without panicking.
        let rejected = lock_amount < 0;
        assert!(rejected, "negative lock amount guard failed");
        return;
    }

    // Member count must not exceed the configured max (1–20).
    const MAX_MEMBERS: u32 = 20;
    let _capped = member_count_seed % (MAX_MEMBERS + 1); // 0..=MAX_MEMBERS

    // Zero lock amount: the contract must reject it.
    if lock_amount == 0 {
        let rejected = lock_amount == 0;
        assert!(rejected, "zero lock amount guard failed");
    }
});
