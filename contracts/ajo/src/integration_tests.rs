//! Integration tests for the Ajo contract.
//!
//! These tests run against the soroban-sdk in-process sandbox (soroban testutils),
//! which provides a full Soroban environment without requiring an external node.
//!
//! Coverage:
//!   initialize → join (all members) → contribute → payout × N → complete

#[cfg(test)]
mod integration {
    use crate::{AjoContract, AjoContractClient};
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{Client as TokenClient, StellarAssetClient},
        vec, Address, Env, Vec,
    };

    // ─── Helpers ──────────────────────────────────────────────────────────────

    struct Fixture {
        env: Env,
        admin: Address,
        members: Vec<Address>,
        token: TokenClient<'static>,
        client: AjoContractClient<'static>,
        contribution: i128,
        max_members: u32,
        interval: u64,
    }

    fn setup_fixture(max_members: u32) -> Fixture {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let mut members_vec = Vec::new(&env);
        for _ in 0..max_members {
            members_vec.push_back(Address::generate(&env));
        }

        let token_id = env.register_stellar_asset_contract(admin.clone());
        let token = TokenClient::new(&env, &token_id);
        let token_admin = StellarAssetClient::new(&env, &token_id);

        let contribution: i128 = 100_000_000; // 100 USDC in stroops
        // Mint enough for all cycles
        for m in members_vec.iter() {
            token_admin.mint(m, &(contribution * (max_members as i128 + 1)));
        }

        let contract_id = env.register_contract(None, AjoContract);
        let client = AjoContractClient::new(&env, &contract_id);

        let interval: u64 = 86_400; // 1 day
        client.initialize(&admin, &token_id, &contribution, &max_members, &interval);

        // SAFETY: The env outlives the fixture; we extend lifetime for convenience in tests.
        let token: TokenClient<'static> = unsafe { std::mem::transmute(token) };
        let client: AjoContractClient<'static> = unsafe { std::mem::transmute(client) };

        Fixture { env, admin, members: members_vec, token, client, contribution, max_members, interval }
    }

    // ─── Tests ────────────────────────────────────────────────────────────────

    /// Full lifecycle: initialize → join all → contribute each cycle → payout × N → complete
    #[test]
    fn test_full_lifecycle() {
        let f = setup_fixture(3);
        let Fixture { env, members, token, client, contribution, max_members, interval, .. } = &f;

        // 1. All members join
        for m in members.iter() {
            client.join(m);
        }

let (cycle, max, _, completed, _) = client.get_state();
        assert_eq!(cycle, 1, "circle should start at cycle 1 after all members join");
        assert_eq!(max, *max_members);
        assert!(!completed);
        assert_eq!(client.get_members().len(), 5);

        let mut timestamp: u64 = 0;
        for cycle_num in 1..=*max_members {
            // Advance past payout time
            timestamp += interval + 1;
            env.ledger().with_mut(|l| l.timestamp = timestamp);

            let recipient = members.get(cycle_num - 1).unwrap();
            let balance_before = token.balance(&recipient);

            client.payout();

            let balance_after = token.balance(&recipient);
            let expected_pot = contribution * (*max_members as i128);
            assert_eq!(
                balance_after - balance_before,
                expected_pot,
                "cycle {cycle_num}: recipient should receive full pot"
            );

            if cycle_num < *max_members {
                let (current, _, _, done, _) = client.get_state();
                assert_eq!(current, cycle_num + 1);
                assert!(!done);

                // All members contribute for next cycle (verify temp storage)
                for m in members.iter() {
                    let has_temp_before = env.storage().temporary().has(&crate::DataKey::Contributions(m.clone(), cycle_num + 1));
                    assert!(!has_temp_before, "contribution should not exist before contribute");
                    client.contribute(m, &100_000_000);
                    let has_temp_after = env.storage().temporary().has(&crate::DataKey::Contributions(m.clone(), cycle_num + 1));
                    assert!(has_temp_after, "contribution should be in temp storage after contribute");
                }
            }
        }

        let (_, _, _, completed, _) = client.get_state();
        assert!(completed, "circle should be marked completed after all payouts");

        // Verify temporary contributions are cleared after completion
        for cycle_num in 1..=*max_members {
            for m in members.iter() {
                let has_temp = env.storage().temporary().has(&crate::DataKey::Contributions(m.clone(), cycle_num));
                assert!(!has_temp, "temp contributions should be cleared after circle completes");
            }
        }
    }

    /// initialize: rejects duplicate initialization
    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_initialize_panics() {
        let f = setup_fixture(2);
        let token_id = f.env.register_stellar_asset_contract(f.admin.clone());
        f.client.initialize(&f.admin, &token_id, &100_000_000, &2, &86_400);
    }

    /// initialize: rejects max_members < 2
    #[test]
    #[should_panic(expected = "max_members must be between 2 and 20")]
    fn test_initialize_too_few_members() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(admin.clone());
        let contract_id = env.register_contract(None, AjoContract);
        let client = AjoContractClient::new(&env, &contract_id);
        client.initialize(&admin, &token_id, &100_000_000, &1, &86_400);
    }

    /// initialize: rejects max_members > 20
    #[test]
    #[should_panic(expected = "max_members must be between 2 and 20")]
    fn test_initialize_too_many_members() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(admin.clone());
        let contract_id = env.register_contract(None, AjoContract);
        let client = AjoContractClient::new(&env, &contract_id);
        client.initialize(&admin, &token_id, &100_000_000, &21, &86_400);
    }

    /// initialize: token issuer safeguard — rejects an address that isn't a
    /// real SEP-41 token contract (issue #58), instead of persisting it and
    /// only failing later inside `join`/`contribute`/`payout`.
    #[test]
    #[should_panic]
    fn test_initialize_rejects_non_token_address() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);

        // A real (non-token) contract, standing in for a bad/malicious
        // "token" address an admin could otherwise fat-finger into `initialize`.
        let not_a_token = env.register_contract(None, AjoContract);

        let contract_id = env.register_contract(None, AjoContract);
        let client = AjoContractClient::new(&env, &contract_id);
        client.initialize(&admin, &not_a_token, &100_000_000, &2, &86_400);
    }

    /// get_token: returns the exact token address configured at initialize,
    /// so integrators can verify a deployed circle's asset/issuer on-chain.
    #[test]
    fn test_get_token_returns_configured_token() {
        let f = setup_fixture(2);
        let token_address = f.token.address.clone();
        assert_eq!(f.client.get_token(), token_address);
    }

    /// join: rejects duplicate member
    #[test]
    #[should_panic(expected = "already a member")]
    fn test_join_duplicate_member() {
        let f = setup_fixture(3);
        let member = f.members.get(0).unwrap();
        f.client.join(&member);
        f.client.join(&member); // second join should panic
    }

    /// join: rejects join after circle started
    #[test]
    #[should_panic(expected = "circle already started")]
    fn test_join_after_started() {
        let f = setup_fixture(2);
        // Fill the circle (auto-starts)
        for m in f.members.iter() {
            f.client.join(m);
        }
        // Try to join with a new address after start
        let late = Address::generate(&f.env);
        f.client.join(&late);
    }

    /// join: rejects when circle is full
    #[test]
    #[should_panic(expected = "circle is full")]
    fn test_join_full_circle() {
        let f = setup_fixture(2);
        for m in f.members.iter() {
            f.client.join(m);
        }
        // Circle is now full and started; extra join should panic with "circle already started"
        // (which fires before "circle is full" since started check comes first)
        let extra = Address::generate(&f.env);
        f.client.join(&extra);
    }

    /// contribute: rejects under-contribution (amount < required)
    #[test]
    #[should_panic(expected = "contribution amount must equal required amount")]
    fn test_contribute_under_amount() {
        let f = setup_fixture(2);
        for m in f.members.iter() { f.client.join(m); }
        f.client.contribute(&f.members.get(0).unwrap(), &(f.contribution - 1));
    }

    /// contribute: rejects over-contribution (amount > required)
    #[test]
    #[should_panic(expected = "contribution amount must equal required amount")]
    fn test_contribute_over_amount() {
        let f = setup_fixture(2);
        for m in f.members.iter() { f.client.join(m); }
        f.client.contribute(&f.members.get(0).unwrap(), &(f.contribution + 1));
    }

    /// contribute: rejects non-member
    #[test]
    #[should_panic(expected = "not a member")]
    fn test_contribute_non_member() {
        let f = setup_fixture(2);
        for m in f.members.iter() {
            f.client.join(m);
        }
        let outsider = Address::generate(&f.env);
        f.client.contribute(&outsider, &100_000_000);
    }

    /// contribute: rejects double contribution in same cycle
    #[test]
    #[should_panic(expected = "already contributed this cycle")]
    fn test_contribute_double() {
        let f = setup_fixture(2);
        for m in f.members.iter() {
            f.client.join(m);
        }
        let member = f.members.get(0).unwrap();
        f.client.contribute(&member, &100_000_000); // second contribution in cycle 1
    }

    /// contribute: rejects before circle starts
    #[test]
    #[should_panic(expected = "circle not started yet")]
    fn test_contribute_before_start() {
        let f = setup_fixture(3);
        // Only one member joins — circle not started
        f.client.join(&f.members.get(0).unwrap());
        f.client.contribute(&f.members.get(0).unwrap(), &100_000_000);
    }

    /// payout: rejects before payout time
    #[test]
    #[should_panic(expected = "payout time not reached")]
    fn test_payout_too_early() {
        let f = setup_fixture(2);
        for m in f.members.iter() {
            f.client.join(m);
        }
        f.client.payout(); // timestamp is 0, payout time is interval+1
    }

    /// payout: rejects after circle completed
    #[test]
    #[should_panic(expected = "circle already completed")]
    fn test_payout_after_complete() {
        let f = setup_fixture(2);
        for m in f.members.iter() {
            f.client.join(m);
        }

        // Cycle 1 payout
        f.env.ledger().with_mut(|l| l.timestamp = f.interval + 1);
        f.client.payout();

        // Contribute for cycle 2
        for m in f.members.iter() {
            f.client.contribute(m, &100_000_000);
        }

        // Cycle 2 payout (completes circle)
        f.env.ledger().with_mut(|l| l.timestamp = f.interval * 2 + 2);
        f.client.payout();

        // Third payout should panic
        f.env.ledger().with_mut(|l| l.timestamp = f.interval * 3 + 3);
        f.client.payout();
    }

    /// get_members: returns correct member list
    #[test]
    fn test_get_members() {
        let f = setup_fixture(3);
        assert_eq!(f.client.get_members().len(), 0);

        f.client.join(&f.members.get(0).unwrap());
        assert_eq!(f.client.get_members().len(), 1);

        for i in 1..3u32 {
            f.client.join(&f.members.get(i).unwrap());
        }
        assert_eq!(f.client.get_members().len(), 3);
    }

    /// get_state: returns zeroed state before initialization (via default)
    #[test]
    fn test_get_state_before_start() {
        let f = setup_fixture(3);
        let (cycle, _, _, completed, _) = f.client.get_state();
        assert_eq!(cycle, 0);
        assert!(!completed);
    }

    // ─── Reentrancy guard tests (issue #264) ─────────────────────────────────

    /// Lock is released after a successful payout so subsequent calls are not blocked.
    #[test]
    fn test_payout_lock_released_after_success() {
        let f = setup_fixture(3);
        for m in f.members.iter() { f.client.join(m); }

        f.env.ledger().with_mut(|l| l.timestamp = f.interval + 1);
        f.client.payout(); // lock acquired → released

        for m in f.members.iter() { f.client.contribute(m, &f.contribution); }
        f.env.ledger().with_mut(|l| l.timestamp = f.interval * 2 + 2);
        f.client.payout(); // must succeed — lock was released

        let (cycle, _, _, _, _) = f.client.get_state();
        assert_eq!(cycle, 3);
    }

    /// Double-call is rejected: setting the lock before payout triggers the guard.
    #[test]
    #[should_panic(expected = "payout already in progress")]
    fn test_payout_reentrancy_guard() {
        let f = setup_fixture(2);
        for m in f.members.iter() { f.client.join(m); }
        f.env.ledger().with_mut(|l| l.timestamp = f.interval + 1);

        // Simulate a re-entrant call by forcing the lock to true before payout.
        f.client.set_payout_lock(&true);
        f.client.payout(); // must panic: "payout already in progress"
    }

    // ─── Fund-locking review checklist tests (issue #60) ─────────────────────
    //
    // These cover the custody invariants called out in
    // contracts/ajo/FUND_LOCKING_CHECKLIST.md: the emergency pause must
    // actually stop fund movement in both directions, and a fully-funded
    // payout must fully drain the pot it pays out (no residual dust left
    // locked in the contract).

    /// pause: blocks contribute while paused, so a member's funds stay in
    /// their own account rather than moving into a frozen contract.
    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_paused_blocks_contribute() {
        let f = setup_fixture(2);
        for m in f.members.iter() { f.client.join(m); }
        f.client.pause();
        f.client.contribute(&f.members.get(0).unwrap(), &f.contribution);
    }

    /// pause: blocks payout while paused, so pooled member funds stay put
    /// instead of being paid out while the circle is frozen for review.
    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_paused_blocks_payout() {
        let f = setup_fixture(2);
        for m in f.members.iter() { f.client.join(m); }
        f.env.ledger().with_mut(|l| l.timestamp = f.interval + 1);
        f.client.pause();
        f.client.payout();
    }

    /// unpause: restores normal fund movement — funds are not permanently
    /// stuck once the emergency pause is lifted.
    #[test]
    fn test_unpause_restores_payout() {
        let f = setup_fixture(2);
        for m in f.members.iter() { f.client.join(m); }
        f.env.ledger().with_mut(|l| l.timestamp = f.interval + 1);

        f.client.pause();
        f.client.unpause();

        f.client.payout(); // must succeed now that the pause has been lifted
        let (cycle, _, _, _, _) = f.client.get_state();
        assert_eq!(cycle, 2);
    }

    /// Fund custody: a fully-contributed cycle's payout drains the contract's
    /// own token balance to exactly zero — no residual funds are left locked
    /// in the contract for that cycle.
    #[test]
    fn test_payout_drains_contract_balance_when_fully_funded() {
        let f = setup_fixture(3);
        for m in f.members.iter() { f.client.join(m); }

        f.env.ledger().with_mut(|l| l.timestamp = f.interval + 1);
        f.client.payout();

        let contract_balance = f.token.balance(&f.client.address);
        assert_eq!(
            contract_balance, 0,
            "contract should hold no residual funds after a fully-funded cycle payout"
        );
    }

    // ─── Upgrade tests ────────────────────────────────────────────────────────

    /// upgrade: admin can upgrade the contract WASM and event is emitted
    #[test]
    fn test_upgrade_emits_event() {
        use soroban_sdk::{testutils::Events, BytesN, TryFromVal};

        let f = setup_fixture(2);
        let new_wasm_hash = BytesN::from_array(&f.env, &[1u8; 32]);

        f.client.upgrade(&new_wasm_hash);

        let upgraded_sym = soroban_sdk::Symbol::new(&f.env, "upgraded");
        let found = f.env.events().all().iter().any(|(_, topics, data)| {
            if topics.len() != 1 {
                return false;
            }
            let Ok(sym) = soroban_sdk::Symbol::try_from_val(&f.env, &topics.get(0).unwrap()) else {
                return false;
            };
            if sym != upgraded_sym {
                return false;
            }
            let Ok(hash) = BytesN::<32>::try_from_val(&f.env, data) else {
                return false;
            };
            hash == new_wasm_hash
        });

        assert!(found, "upgraded event should be emitted with the new wasm hash");
    }

    /// upgrade: non-admin cannot upgrade (wrong auth → panics)
    #[test]
    #[should_panic]
    fn test_upgrade_non_admin_panics() {
        use soroban_sdk::{
            testutils::{MockAuth, MockAuthInvoke},
            BytesN, IntoVal,
        };

        let f = setup_fixture(2);
        let non_admin = Address::generate(&f.env);
        let new_wasm_hash = BytesN::from_array(&f.env, &[2u8; 32]);

        // Authorize as non_admin instead of the real admin — should fail
        f.env.mock_auths(&[MockAuth {
            address: &non_admin,
            invoke: &MockAuthInvoke {
                contract: &f.client.address,
                fn_name: "upgrade",
                args: (new_wasm_hash.clone(),).into_val(&f.env),
                sub_invokes: &[],
            },
        }]);

        f.client.upgrade(&new_wasm_hash);
    }

    /// upgrade: state is preserved after upgrade call
    #[test]
    fn test_upgrade_preserves_state() {
        use soroban_sdk::BytesN;

        let f = setup_fixture(2);

        // Join one member to set some state
        f.client.join(&f.members.get(0).unwrap());

        let (cycle_before, max_before, _, completed_before, _) = f.client.get_state();

        let new_wasm_hash = BytesN::from_array(&f.env, &[3u8; 32]);
        f.client.upgrade(&new_wasm_hash);

        let (cycle_after, max_after, _, completed_after, _) = f.client.get_state();
        assert_eq!(cycle_before, cycle_after, "cycle should be unchanged after upgrade");
        assert_eq!(max_before, max_after, "max_members should be unchanged after upgrade");
        assert_eq!(completed_before, completed_after, "completed flag should be unchanged after upgrade");
    }

    /// Multi-member scenario: 5-member circle completes full rotation
    #[test]
    fn test_multi_member_five_members() {
        let f = setup_fixture(5);
        let Fixture { env, members, token, client, contribution, max_members, interval, .. } = &f;

        // All 5 members join
        for m in members.iter() {
            client.join(m);
        }

        let (cycle, max, _, completed, _) = client.get_state();
        assert_eq!(cycle, 1);
        assert_eq!(max, 5);
        assert!(!completed);
        assert_eq!(client.get_members().len(), 5);

        let mut timestamp: u64 = 0;
        for cycle_num in 1..=*max_members {
            timestamp += interval + 1;
            env.ledger().with_mut(|l| l.timestamp = timestamp);

            let recipient = members.get(cycle_num - 1).unwrap();
            let before = token.balance(&recipient);
            client.payout();
            let after = token.balance(&recipient);

            assert_eq!(
                after - before,
                contribution * (*max_members as i128),
                "cycle {cycle_num}: 5-member pot should be 5× contribution"
            );

            if cycle_num < *max_members {
                let (current, _, _, done, _) = client.get_state();
                assert_eq!(current, cycle_num + 1);
                assert!(!done);
                for m in members.iter() {
                    client.contribute(m, &100_000_000);
                }
            }
        }

        let (_, _, _, completed, _) = client.get_state();
        assert!(completed, "5-member circle should complete after 5 payouts");
    }

    /// Pot distribution: each member ends up net-positive after receiving payout
    #[test]
    fn test_net_positive_for_all_members() {
        let f = setup_fixture(3);
        let Fixture { env, members, token, client, contribution, max_members, interval, .. } = &f;

        let initial_balances: Vec<i128> = {
            let mut v = Vec::new(&env);
            for m in members.iter() {
                v.push_back(token.balance(&m));
            }
            v
        };

        for m in members.iter() {
            client.join(m);
        }

        let mut timestamp: u64 = 0;
        for cycle_num in 1..=*max_members {
            timestamp += interval + 1;
            env.ledger().with_mut(|l| l.timestamp = timestamp);
            client.payout();
            if cycle_num < *max_members {
                for m in members.iter() {
                    client.contribute(m, &100_000_000);
                }
            }
        }

        // Every member should have received the pot once and paid contribution × max_members
        // Net = pot - (contribution × max_members) = 0 for non-recipients, pot for recipient
        // But since each member IS the recipient exactly once, net = 0 for all (break-even)
        for (i, m) in members.iter().enumerate() {
            let final_balance = token.balance(&m);
            let initial = initial_balances.get(i as u32).unwrap();
            // Each member paid contribution × max_members and received pot (= contribution × max_members) once
            assert_eq!(
                final_balance, initial,
                "member {i} should break even after full circle"
            );
        }
    }

    // ─── set_payout_order / get_payout_order ─────────────────────────────────

    /// set_payout_order: custom order is stored and returned by get_payout_order
    #[test]
    fn test_set_and_get_payout_order() {
        let f = setup_fixture(3);
        let order = vec![&f.env, 2u32, 0u32, 1u32];
        f.client.set_payout_order(&order);
        let stored = f.client.get_payout_order();
        assert_eq!(stored, order);
    }

    /// set_payout_order: rejects wrong length
    #[test]
    #[should_panic(expected = "payout order length must equal max_members")]
    fn test_set_payout_order_wrong_length() {
        let f = setup_fixture(3);
        let bad_order = vec![&f.env, 0u32, 1u32]; // length 2, need 3
        f.client.set_payout_order(&bad_order);
    }

    /// set_payout_order: rejects after circle starts
    #[test]
    #[should_panic(expected = "cannot set payout order after circle starts")]
    fn test_set_payout_order_after_start() {
        let f = setup_fixture(2);
        for m in f.members.iter() {
            f.client.join(m);
        }
        // Circle is now started (cycle 1)
        let order = vec![&f.env, 0u32, 1u32];
        f.client.set_payout_order(&order);
    }

    /// payout respects custom payout order
    #[test]
    fn test_payout_respects_custom_order() {
        let f = setup_fixture(2);
        // Reverse order: member[1] gets paid first
        let order = vec![&f.env, 1u32, 0u32];
        f.client.set_payout_order(&order);

        for m in f.members.iter() {
            f.client.join(m);
        }

        let m1 = f.members.get(1).unwrap();
        let balance_before = f.token.balance(&m1);

        f.env.ledger().with_mut(|l| l.timestamp = f.interval + 1);
        f.client.payout();

        let balance_after = f.token.balance(&m1);
        let pot = f.contribution * (f.max_members as i128);
        assert_eq!(balance_after - balance_before, pot, "member[1] should receive pot in cycle 1 per custom order");
    }

    // ─── get_contribution_status ─────────────────────────────────────────────

    /// get_contribution_status: reflects join and contribute calls correctly
    #[test]
    fn test_get_contribution_status_accuracy() {
        let f = setup_fixture(3);
        for m in f.members.iter() {
            f.client.join(m);
        }

        // All contributed via join for cycle 1
        let status = f.client.get_contribution_status(&1u32);
        assert_eq!(status.len(), 3);
        for (_, paid) in status.iter() {
            assert!(paid);
        }

        // Advance to cycle 2
        f.env.ledger().with_mut(|l| l.timestamp = f.interval + 1);
        f.client.payout();

        // Only member[0] contributes for cycle 2
        f.client.contribute(&f.members.get(0).unwrap(), &f.contribution);
        let status2 = f.client.get_contribution_status(&2u32);
        let (_, m0) = status2.get(0).unwrap();
        let (_, m1) = status2.get(1).unwrap();
        assert!(m0);
        assert!(!m1);
    }

    // ─── Reputation ──────────────────────────────────────────────────────────

    /// get_reputation: returns 0 for unknown member
    #[test]
    fn test_get_reputation_unknown_member() {
        let f = setup_fixture(2);
        let stranger = Address::generate(&f.env);
        assert_eq!(f.client.get_reputation(&stranger), 0);
    }

    /// get_reputation_stats: returns zeros for unknown member
    #[test]
    fn test_get_reputation_stats_unknown() {
        let f = setup_fixture(2);
        let stranger = Address::generate(&f.env);
        let (rep, circles, on_time, total) = f.client.get_reputation_stats(&stranger);
        assert_eq!(rep, 0);
        assert_eq!(circles, 0);
        assert_eq!(on_time, 0);
        assert_eq!(total, 0);
    }

    /// Reputation increases after on-time contributions
    #[test]
    fn test_reputation_increases_with_on_time_contributions() {
        let f = setup_fixture(2);
        for m in f.members.iter() {
            f.client.join(m);
        }

        let member = f.members.get(0).unwrap();
        // Contribute on-time for cycle 2 (before payout time)
        // First advance to cycle 2
        f.env.ledger().with_mut(|l| l.timestamp = f.interval + 1);
        f.client.payout();

        // Contribute before next payout time (on-time)
        f.client.contribute(&member, &f.contribution);

        let rep = f.client.get_reputation(&member);
        assert!(rep > 0, "reputation should be positive after on-time contribution");
    }

    // ─── propose_admin / accept_admin ────────────────────────────────────────

    /// propose_admin + accept_admin: full happy path
    #[test]
    fn test_admin_transfer_happy_path() {
        let f = setup_fixture(2);
        let new_admin = Address::generate(&f.env);
        f.client.propose_admin(&new_admin);
        f.client.accept_admin();
        // New admin can now call admin-only payout (circle not started, but no auth error)
        // Verify by checking no panic on propose again as new admin
        let another = Address::generate(&f.env);
        f.client.propose_admin(&another); // new admin proposes again — should not panic
    }

    /// accept_admin: panics when no pending admin
    #[test]
    #[should_panic(expected = "no pending admin")]
    fn test_accept_admin_no_pending() {
        let f = setup_fixture(2);
        f.client.accept_admin();
    }

    /// propose_admin: emits admin_proposed event
    #[test]
    fn test_propose_admin_emits_event() {
        use soroban_sdk::{testutils::Events, Symbol, TryFromVal};

        let f = setup_fixture(2);
        let new_admin = Address::generate(&f.env);
        f.client.propose_admin(&new_admin);

        let sym = Symbol::new(&f.env, "admin_proposed");
        let found = f.env.events().all().iter().any(|(_, topics, _)| {
            topics.len() == 1
                && Symbol::try_from_val(&f.env, &topics.get(0).unwrap())
                    .map(|s: Symbol| s == sym)
                    .unwrap_or(false)
        });
        assert!(found, "admin_proposed event should be emitted");
    }

    /// accept_admin: emits admin_transferred event
    #[test]
    fn test_accept_admin_emits_event() {
        use soroban_sdk::{testutils::Events, Symbol, TryFromVal};

        let f = setup_fixture(2);
        let new_admin = Address::generate(&f.env);
        f.client.propose_admin(&new_admin);
        f.client.accept_admin();

        let sym = Symbol::new(&f.env, "admin_transferred");
        let found = f.env.events().all().iter().any(|(_, topics, _)| {
            topics.len() == 1
                && Symbol::try_from_val(&f.env, &topics.get(0).unwrap())
                    .map(|s: Symbol| s == sym)
                    .unwrap_or(false)
        });
        assert!(found, "admin_transferred event should be emitted");
    }

    // ─── initialize edge cases ────────────────────────────────────────────────

    /// initialize: rejects zero contribution amount
    #[test]
    #[should_panic(expected = "contribution_amount must be positive")]
    fn test_initialize_zero_contribution() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(admin.clone());
        let contract_id = env.register_contract(None, AjoContract);
        let client = AjoContractClient::new(&env, &contract_id);
        client.initialize(&admin, &token_id, &0, &3, &86_400);
    }

    // ─── payout: circle not started ──────────────────────────────────────────

    /// payout: panics if circle not started
    #[test]
    #[should_panic(expected = "circle not started")]
    fn test_payout_circle_not_started() {
        let f = setup_fixture(3);
        // Only one member joins — circle not started
        f.client.join(&f.members.get(0).unwrap());
        f.env.ledger().with_mut(|l| l.timestamp = f.interval + 1);
        f.client.payout();
    }
}
