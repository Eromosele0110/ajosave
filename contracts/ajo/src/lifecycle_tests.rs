//! Lifecycle invariant tests (issue #46) plus regression coverage for
//! initialization address validation (#47), interval overflow guards (#48)
//! and payout permutation validation (#49).
//!
//! Invariants checked after every state transition:
//!   I1. contract balance == total contributed - total paid out
//!   I2. current_cycle never decreases and stays within 0..=max_members
//!   I3. next_payout_time strictly increases between cycles
//!   I4. every member receives exactly one pot per circle
//!   I5. once completed, the contract holds no funds and rejects payouts

use crate::{AjoContract, AjoContractClient, MAX_CYCLE_INTERVAL_SECS};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Env, Vec,
};

const CONTRIBUTION: i128 = 100_000_000;
const INTERVAL: u64 = 86_400;

struct Ctx {
    env: Env,
    admin: Address,
    token_id: Address,
    members: Vec<Address>,
    token: TokenClient<'static>,
    client: AjoContractClient<'static>,
}

fn fresh(max_members: u32) -> (Env, Address, Address, Vec<Address>, AjoContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract(admin.clone());
    let token_admin = StellarAssetClient::new(&env, &token_id);
    let mut members = Vec::new(&env);
    for _ in 0..max_members {
        let m = Address::generate(&env);
        token_admin.mint(&m, &(CONTRIBUTION * (max_members as i128 + 1)));
        members.push_back(m);
    }
    let contract_id = env.register_contract(None, AjoContract);
    let client = AjoContractClient::new(&env, &contract_id);
    // SAFETY: env outlives the client for the duration of each test.
    let client: AjoContractClient<'static> = unsafe { std::mem::transmute(client) };
    (env, admin, token_id, members, client)
}

fn setup(max_members: u32) -> Ctx {
    let (env, admin, token_id, members, client) = fresh(max_members);
    client.initialize(&admin, &token_id, &CONTRIBUTION, &max_members, &INTERVAL);
    let token = TokenClient::new(&env, &token_id);
    let token: TokenClient<'static> = unsafe { std::mem::transmute(token) };
    Ctx { env, admin, token_id, members, token, client }
}

fn contract_balance(c: &Ctx) -> i128 {
    c.token.balance(&c.client.address)
}

fn run_full_circle(c: &Ctx, order: Option<Vec<u32>>) -> std::vec::Vec<Address> {
    let n = c.members.len();
    if let Some(o) = order {
        c.client.set_payout_order(&o);
    }
    let mut contributed: i128 = 0;
    let mut paid_out: i128 = 0;
    let mut last_cycle = 0u32;

    for m in c.members.iter() {
        c.client.join(&m);
        contributed += CONTRIBUTION;
        assert_eq!(contract_balance(c), contributed - paid_out, "I1 after join");
    }

    let mut recipients = std::vec::Vec::new();
    let mut last_next_payout = 0u64;
    let mut now = 0u64;
    for cycle in 1..=n {
        let (cur, _, next_payout, completed, _) = c.client.get_state();
        assert!(!completed);
        assert_eq!(cur, cycle);
        assert!(cur >= last_cycle && cur <= n, "I2");
        assert!(next_payout > last_next_payout, "I3");
        last_cycle = cur;
        last_next_payout = next_payout;

        if cycle > 1 {
            for m in c.members.iter() {
                c.client.contribute(&m, &CONTRIBUTION);
                contributed += CONTRIBUTION;
            }
        }
        assert_eq!(contract_balance(c), contributed - paid_out, "I1 before payout");

        now = next_payout.max(now);
        c.env.ledger().with_mut(|l| l.timestamp = now);
        let before: std::vec::Vec<i128> = c.members.iter().map(|m| c.token.balance(&m)).collect();
        c.client.payout();
        paid_out += CONTRIBUTION * n as i128;
        assert_eq!(contract_balance(c), contributed - paid_out, "I1 after payout");

        let winners: std::vec::Vec<Address> = c
            .members
            .iter()
            .zip(before.iter())
            .filter(|(m, b)| c.token.balance(m) > **b)
            .map(|(m, _)| m)
            .collect();
        assert_eq!(winners.len(), 1, "exactly one recipient per cycle");
        recipients.push(winners[0].clone());
    }

    // I4: every member paid exactly once.
    for m in c.members.iter() {
        assert_eq!(recipients.iter().filter(|r| **r == m).count(), 1, "I4");
    }
    // I5: completed and drained.
    let (_, _, _, completed, _) = c.client.get_state();
    assert!(completed);
    assert_eq!(contract_balance(c), 0, "I5");
    recipients
}

// ─── #46 lifecycle invariants ───────────────────────────────────────────────

#[test]
fn lifecycle_invariants_hold_for_all_sizes() {
    for n in [2u32, 3, 5, 10, 20] {
        let c = setup(n);
        run_full_circle(&c, None);
    }
}

#[test]
fn lifecycle_invariants_hold_with_custom_order() {
    let c = setup(4);
    let order = vec![&c.env, 3u32, 1, 0, 2];
    let recipients = run_full_circle(&c, Some(order.clone()));
    for (i, idx) in order.iter().enumerate() {
        assert_eq!(recipients[i], c.members.get(idx).unwrap());
    }
}

#[test]
fn lifecycle_default_order_is_join_order() {
    let c = setup(3);
    let recipients = run_full_circle(&c, None);
    for (i, m) in c.members.iter().enumerate() {
        assert_eq!(recipients[i], m);
    }
}

#[test]
#[should_panic(expected = "circle already completed")]
fn lifecycle_payout_after_completion_rejected() {
    let c = setup(2);
    run_full_circle(&c, None);
    c.env.ledger().with_mut(|l| l.timestamp += INTERVAL * 10);
    c.client.payout();
}

#[test]
#[should_panic(expected = "circle already started")]
fn lifecycle_join_after_start_rejected() {
    let c = setup(2);
    for m in c.members.iter() {
        c.client.join(&m);
    }
    c.client.join(&Address::generate(&c.env));
}

#[test]
#[should_panic(expected = "payout time not reached")]
fn lifecycle_early_payout_rejected_at_boundary() {
    let c = setup(2);
    for m in c.members.iter() {
        c.client.join(&m);
    }
    let (_, _, next_payout, _, _) = c.client.get_state();
    c.env.ledger().with_mut(|l| l.timestamp = next_payout - 1);
    c.client.payout();
}

#[test]
fn lifecycle_payout_allowed_exactly_at_boundary() {
    let c = setup(2);
    for m in c.members.iter() {
        c.client.join(&m);
    }
    let (_, _, next_payout, _, _) = c.client.get_state();
    c.env.ledger().with_mut(|l| l.timestamp = next_payout);
    c.client.payout();
    assert_eq!(c.client.get_state().0, 2);
}

// ─── #47 initialization address validation ──────────────────────────────────

#[test]
#[should_panic(expected = "admin and token must differ")]
fn init_rejects_admin_equal_token() {
    let (_, _, token_id, _, client) = fresh(2);
    client.initialize(&token_id, &token_id, &CONTRIBUTION, &2, &INTERVAL);
}

#[test]
#[should_panic(expected = "admin cannot be the contract itself")]
fn init_rejects_contract_as_admin() {
    let (_, _, token_id, _, client) = fresh(2);
    client.initialize(&client.address, &token_id, &CONTRIBUTION, &2, &INTERVAL);
}

#[test]
#[should_panic(expected = "token cannot be the contract itself")]
fn init_rejects_contract_as_token() {
    let (_, admin, _, _, client) = fresh(2);
    client.initialize(&admin, &client.address, &CONTRIBUTION, &2, &INTERVAL);
}

#[test]
#[should_panic(expected = "already initialized")]
fn init_rejects_reinitialization() {
    let c = setup(2);
    c.client.initialize(&c.admin, &c.token_id, &CONTRIBUTION, &2, &INTERVAL);
}

// ─── #48 interval overflow guards ───────────────────────────────────────────

#[test]
#[should_panic(expected = "cycle_interval_secs out of range")]
fn init_rejects_zero_interval() {
    let (_, admin, token_id, _, client) = fresh(2);
    client.initialize(&admin, &token_id, &CONTRIBUTION, &2, &0);
}

#[test]
#[should_panic(expected = "cycle_interval_secs out of range")]
fn init_rejects_interval_above_max() {
    let (_, admin, token_id, _, client) = fresh(2);
    client.initialize(&admin, &token_id, &CONTRIBUTION, &2, &(MAX_CYCLE_INTERVAL_SECS + 1));
}

#[test]
#[should_panic(expected = "cycle_interval_secs out of range")]
fn init_rejects_u64_max_interval() {
    let (_, admin, token_id, _, client) = fresh(2);
    client.initialize(&admin, &token_id, &CONTRIBUTION, &2, &u64::MAX);
}

#[test]
fn init_accepts_interval_bounds() {
    for interval in [1u64, MAX_CYCLE_INTERVAL_SECS] {
        let (_, admin, token_id, _, client) = fresh(2);
        client.initialize(&admin, &token_id, &CONTRIBUTION, &2, &interval);
    }
}

#[test]
#[should_panic(expected = "contribution_amount too large")]
fn init_rejects_pot_overflow() {
    let (_, admin, token_id, _, client) = fresh(2);
    client.initialize(&admin, &token_id, &i128::MAX, &2, &INTERVAL);
}

#[test]
#[should_panic(expected = "next payout time overflow")]
fn join_rejects_timestamp_overflow() {
    let c = setup(2);
    c.env.ledger().with_mut(|l| l.timestamp = u64::MAX - INTERVAL + 1);
    for m in c.members.iter() {
        c.client.join(&m);
    }
}

// ─── #49 payout permutation validation ──────────────────────────────────────

#[test]
#[should_panic(expected = "payout order contains duplicate index")]
fn payout_order_rejects_duplicates() {
    let c = setup(3);
    c.client.set_payout_order(&vec![&c.env, 0u32, 0, 1]);
}

#[test]
#[should_panic(expected = "payout order index out of range")]
fn payout_order_rejects_out_of_range() {
    let c = setup(3);
    c.client.set_payout_order(&vec![&c.env, 0u32, 1, 3]);
}

#[test]
#[should_panic(expected = "payout order index out of range")]
fn payout_order_rejects_u32_max() {
    let c = setup(2);
    c.client.set_payout_order(&vec![&c.env, u32::MAX, 0]);
}

#[test]
fn payout_order_accepts_every_permutation_of_three() {
    let perms: [[u32; 3]; 6] = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for p in perms {
        let c = setup(3);
        let order = vec![&c.env, p[0], p[1], p[2]];
        c.client.set_payout_order(&order);
        assert_eq!(c.client.get_payout_order(), order);
    }
}

#[test]
fn payout_order_accepts_reverse_at_max_size() {
    let c = setup(20);
    let mut order = Vec::new(&c.env);
    for i in (0..20u32).rev() {
        order.push_back(i);
    }
    c.client.set_payout_order(&order);
    assert_eq!(c.client.get_payout_order(), order);
}
