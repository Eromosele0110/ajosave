//! Tests for issues #50 (missed contribution policy), #51 (temporary storage
//! TTL), #52 (admin authorization) and #53 (malicious token reentrancy).

use super::*;
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{storage::Temporary as _, Address as _, Ledger, MockAuth, MockAuthInvoke},
    token::StellarAssetClient,
    Env, IntoVal,
};

const AMOUNT: i128 = 100_000_000;
const INTERVAL: u64 = 86_400;

fn setup(env: &Env) -> (Address, Vec<Address>, AjoContractClient<'_>) {
    let admin = Address::generate(env);
    let members = vec![env, Address::generate(env), Address::generate(env), Address::generate(env)];
    let token_id = env.register_stellar_asset_contract(admin.clone());
    let token_admin = StellarAssetClient::new(env, &token_id);
    for m in members.iter() {
        token_admin.mint(&m, &1_000_000_000);
    }
    let contract_id = env.register_contract(None, AjoContract);
    let client = AjoContractClient::new(env, &contract_id);
    client.initialize(&admin, &token_id, &AMOUNT, &3, &INTERVAL);
    (admin, members, client)
}

fn started(env: &Env) -> (Address, Vec<Address>, AjoContractClient<'_>) {
    let (admin, members, client) = setup(env);
    for m in members.iter() {
        client.join(&m);
    }
    (admin, members, client)
}

// ─── #50 Missed contribution policy ───────────────────────────────────────────

#[test]
fn missed_contribution_is_recorded_and_suspends_member() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, members, client) = started(&env);
    let late = members.get(2).unwrap();

    env.ledger().with_mut(|l| l.timestamp = INTERVAL + 1);
    client.payout();

    // Cycle 2: member 2 skips.
    client.contribute(&members.get(0).unwrap(), &AMOUNT);
    client.contribute(&members.get(1).unwrap(), &AMOUNT);
    env.ledger().with_mut(|l| l.timestamp = 2 * INTERVAL + 2);
    client.payout();

    assert_eq!(client.get_missed_contributions(&late), 1);
    assert_eq!(client.get_missed_contributions(&members.get(0).unwrap()), 0);
    assert!(client.is_suspended(&late));
    assert!(client.try_contribute(&late, &AMOUNT).is_err());
}

#[test]
fn missed_policy_threshold_is_respected_and_reinstate_works() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, members, client) = started(&env);
    client.set_missed_policy(&2);
    assert_eq!(client.get_missed_policy(), 2);
    let late = members.get(2).unwrap();

    env.ledger().with_mut(|l| l.timestamp = INTERVAL + 1);
    client.payout();
    env.ledger().with_mut(|l| l.timestamp = 2 * INTERVAL + 2);
    client.payout();

    // Everyone missed cycle 2 once; threshold of 2 not reached.
    assert_eq!(client.get_missed_contributions(&late), 1);
    assert!(!client.is_suspended(&late));

    client.reinstate_member(&late);
    assert!(!client.is_suspended(&late));
}

#[test]
fn missed_policy_rejects_out_of_range_values() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, client) = setup(&env);
    assert!(client.try_set_missed_policy(&0).is_err());
    assert!(client.try_set_missed_policy(&4).is_err());
    assert!(client.try_set_missed_policy(&3).is_ok());
}

#[test]
fn reinstate_rejects_non_member() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, client) = setup(&env);
    assert!(client.try_reinstate_member(&Address::generate(&env)).is_err());
}

// ─── #51 Temporary storage TTL ────────────────────────────────────────────────

#[test]
fn temp_contribution_ttl_outlives_cycle() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, members, client) = started(&env);
    let key = DataKey::Contributions(members.get(0).unwrap(), 1);
    let ttl = env.as_contract(&client.address, || env.storage().temporary().get_ttl(&key));
    let cycle_ledgers = (INTERVAL / 5) as u32;
    assert!(ttl > cycle_ledgers, "ttl {} must exceed cycle length {}", ttl, cycle_ledgers);
}

#[test]
fn temp_contributions_cleared_on_completion() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, members, client) = started(&env);
    for cycle in 1..=3u64 {
        if cycle > 1 {
            for m in members.iter() {
                client.contribute(&m, &AMOUNT);
            }
        }
        env.ledger().with_mut(|l| l.timestamp = cycle * INTERVAL + cycle);
        client.payout();
    }
    env.as_contract(&client.address, || {
        for m in members.iter() {
            for c in 1..=3u32 {
                assert!(!env.storage().temporary().has(&DataKey::Contributions(m.clone(), c)));
            }
        }
    });
}

#[test]
fn ttl_config_validates_bounds() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, client) = setup(&env);
    assert!(client.try_set_ttl_config(&0, &(7 * DAY_IN_LEDGERS)).is_err());
    assert!(client.try_set_ttl_config(&(8 * DAY_IN_LEDGERS), &(7 * DAY_IN_LEDGERS)).is_err());
    assert!(client.try_set_ttl_config(&1, &(DAY_IN_LEDGERS - 1)).is_err());
    assert!(client.try_set_ttl_config(&1, &u32::MAX).is_err());
    assert!(client.try_set_ttl_config(&DAY_IN_LEDGERS, &(7 * DAY_IN_LEDGERS)).is_ok());
}

// ─── #52 Admin authorization ──────────────────────────────────────────────────

fn auth_as<'a>(env: &Env, who: &'a Address, contract: &'a Address, fn_name: &'a str, args: soroban_sdk::Vec<soroban_sdk::Val>) -> [MockAuth<'a>; 1] {
    let _ = env;
    [MockAuth {
        address: who,
        invoke: &MockAuthInvoke { contract, fn_name, args, sub_invokes: &[] },
    }]
}

#[test]
fn admin_functions_reject_non_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, client) = setup(&env);
    let attacker = Address::generate(&env);
    let id = client.address.clone();
    env.set_auths(&[]);

    let order: Vec<u32> = vec![&env, 0, 1, 2];
    let hash = BytesN::from_array(&env, &[0u8; 32]);

    macro_rules! denied {
        ($call:ident, $name:expr, $args:expr $(, $a:expr)*) => {{
            let auths = auth_as(&env, &attacker, &id, $name, $args);
            assert!(client.mock_auths(&auths).$call($($a),*).is_err(), "{} must require admin", $name);
        }};
    }

    denied!(try_set_payout_order, "set_payout_order", (order.clone(),).into_val(&env), &order);
    denied!(try_pause, "pause", ().into_val(&env));
    denied!(try_unpause, "unpause", ().into_val(&env));
    denied!(try_migrate, "migrate", ().into_val(&env));
    denied!(try_upgrade, "upgrade", (hash.clone(),).into_val(&env), &hash);
    denied!(try_propose_admin, "propose_admin", (attacker.clone(),).into_val(&env), &attacker);
    denied!(try_set_ttl_config, "set_ttl_config", (1u32, 7 * DAY_IN_LEDGERS).into_val(&env), &1u32, &(7 * DAY_IN_LEDGERS));
    denied!(try_set_missed_policy, "set_missed_policy", (2u32,).into_val(&env), &2u32);
    denied!(try_reinstate_member, "reinstate_member", (attacker.clone(),).into_val(&env), &attacker);
}

#[test]
fn admin_functions_accept_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, _, client) = setup(&env);
    let id = client.address.clone();
    let auths = auth_as(&env, &admin, &id, "pause", ().into_val(&env));
    assert!(client.mock_auths(&auths).try_pause().is_ok());
    let auths = auth_as(&env, &admin, &id, "set_missed_policy", (2u32,).into_val(&env));
    assert!(client.mock_auths(&auths).try_set_missed_policy(&2u32).is_ok());
}

#[test]
fn payout_rejects_non_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, client) = started(&env);
    env.ledger().with_mut(|l| l.timestamp = INTERVAL + 1);
    let attacker = Address::generate(&env);
    let id = client.address.clone();
    let auths = auth_as(&env, &attacker, &id, "payout", ().into_val(&env));
    assert!(client.mock_auths(&auths).try_payout().is_err());
}

#[test]
fn accept_admin_requires_pending_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, client) = setup(&env);
    let new_admin = Address::generate(&env);
    client.propose_admin(&new_admin);
    let attacker = Address::generate(&env);
    let id = client.address.clone();
    let auths = auth_as(&env, &attacker, &id, "accept_admin", ().into_val(&env));
    assert!(client.mock_auths(&auths).try_accept_admin().is_err());
    let auths = auth_as(&env, &new_admin, &id, "accept_admin", ().into_val(&env));
    assert!(client.mock_auths(&auths).try_accept_admin().is_ok());
}

// ─── #53 Malicious token reentrancy ───────────────────────────────────────────

#[contracttype]
enum EvilKey {
    Target,
    Armed,
    ReentryAttempts,
    ReentrySucceeded,
}

/// A token whose `transfer` tries to re-enter the Ajo contract.
#[contract]
struct EvilToken;

#[contractimpl]
impl EvilToken {
    pub fn arm(env: Env, target: Address) {
        env.storage().instance().set(&EvilKey::Target, &target);
        env.storage().instance().set(&EvilKey::Armed, &true);
    }

    pub fn transfer(env: Env, _from: Address, to: Address, _amount: i128) {
        let armed: bool = env.storage().instance().get(&EvilKey::Armed).unwrap_or(false);
        if !armed {
            return;
        }
        let target: Address = env.storage().instance().get(&EvilKey::Target).unwrap();
        let attempts: u32 = env.storage().instance().get(&EvilKey::ReentryAttempts).unwrap_or(0);
        env.storage().instance().set(&EvilKey::ReentryAttempts, &(attempts + 1));
        let ajo = AjoContractClient::new(&env, &target);
        let ok = ajo.try_payout().is_ok() || ajo.try_contribute(&to, &AMOUNT).is_ok();
        if ok {
            env.storage().instance().set(&EvilKey::ReentrySucceeded, &true);
        }
    }

    pub fn stats(env: Env) -> (u32, bool) {
        (
            env.storage().instance().get(&EvilKey::ReentryAttempts).unwrap_or(0),
            env.storage().instance().get(&EvilKey::ReentrySucceeded).unwrap_or(false),
        )
    }
}

#[test]
fn malicious_token_cannot_reenter_payout() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let evil_id = env.register_contract(None, EvilToken);
    let evil = EvilTokenClient::new(&env, &evil_id);
    let ajo_id = env.register_contract(None, AjoContract);
    let ajo = AjoContractClient::new(&env, &ajo_id);
    ajo.initialize(&admin, &evil_id, &AMOUNT, &2, &INTERVAL);
    ajo.join(&Address::generate(&env));
    ajo.join(&Address::generate(&env));

    evil.arm(&ajo_id);
    env.ledger().with_mut(|l| l.timestamp = INTERVAL + 1);
    ajo.payout();

    let (attempts, succeeded) = evil.stats();
    assert_eq!(attempts, 1, "token transfer should be invoked exactly once");
    assert!(!succeeded, "re-entrant call must not succeed");

    // State advanced exactly one cycle and the lock was released.
    let (cycle, _, _, completed, _) = ajo.get_state();
    assert_eq!(cycle, 2);
    assert!(!completed);
    let locked: bool = env.as_contract(&ajo_id, || {
        env.storage().instance().get(&DataKey::PayoutLock).unwrap_or(false)
    });
    assert!(!locked);
}

#[test]
fn payout_lock_blocks_concurrent_payout() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, client) = started(&env);
    env.ledger().with_mut(|l| l.timestamp = INTERVAL + 1);
    client.set_payout_lock(&true);
    assert!(client.try_payout().is_err());
    client.set_payout_lock(&false);
    assert!(client.try_payout().is_ok());
}
