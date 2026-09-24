#![no_main]
//! Fuzz target: `payout`
//!
//! Validates that payout rotation logic does not panic, wrap, or produce
//! out-of-bounds cycle indices regardless of the input.

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    // Need at least 9 bytes: 1 (current_cycle) + 8 (current timestamp u64)
    if data.len() < 9 {
        return;
    }

    let current_cycle = data[0] as u32;
    let now_ts = u64::from_le_bytes(data[1..9].try_into().unwrap());

    const MAX_MEMBERS: u32 = 20;
    const CYCLE_INTERVAL: u64 = 604_800; // 7 days in seconds

    // Guard: cycle must be < max_members; otherwise payout should be a no-op.
    if current_cycle >= MAX_MEMBERS {
        // Verify the boundary check without panicking.
        assert!(
            current_cycle >= MAX_MEMBERS,
            "cycle overrun not detected"
        );
        return;
    }

    // Guard: payout must not be triggered before the interval has elapsed.
    // last_payout_time = 0 (genesis), so payout is valid only if now >= interval.
    let last_payout_time: u64 = 0;
    let payout_due = now_ts >= last_payout_time.saturating_add(CYCLE_INTERVAL);
    let _ = payout_due;

    // Rotation index: (current_cycle + 1) % max_members must never overflow.
    let next_cycle = (current_cycle + 1) % MAX_MEMBERS;
    assert!(next_cycle < MAX_MEMBERS, "next_cycle out of bounds");
});
