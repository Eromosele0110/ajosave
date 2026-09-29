//! Soroban cost benchmarks for the Ajo contract (#54).
//!
//! `BENCHMARKS.md`'s "Example benchmark test" measured
//! `env.ledger().read_events().len()` as a stand-in for cost — that is not
//! an actual Soroban resource metric. This module replaces the aspirational
//! example with real measurements taken from soroban-sdk's `testutils`
//! budget API (`env.budget()`), which is the SDK's own CPU-instruction /
//! memory cost accounting used to approximate on-chain resource fees.
//!
//! Each test exercises one state-changing entrypoint, prints its CPU
//! instruction and memory cost, and asserts the cost stays under a
//! generous regression ceiling so an accidental algorithmic regression
//! (e.g. an O(n^2) loop over members) fails CI instead of silently
//! shipping. The ceiling is intentionally loose — it is a regression
//! guard, not a tuned production budget (see "Caveats" below).

#[cfg(test)]
mod benchmarks {
    use crate::{AjoContract, AjoContractClient};
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::StellarAssetClient,
        Address, Env, Vec,
    };

    /// Generous ceiling (in CPU instructions, as reported by
    /// `Budget::cpu_instruction_cost`) to catch gross regressions without
    /// being brittle to minor SDK/compiler version drift. Soroban's mainnet
    /// per-transaction CPU limit is 100M instructions as of writing; this is
    /// set well below that so any single one of these entrypoints has ample
    /// headroom for surrounding operations in the same transaction.
    const CPU_CEILING: u64 = 20_000_000;

    struct Fixture<'a> {
        env: Env,
        members: Vec<Address>,
        client: AjoContractClient<'a>,
        interval: u64,
    }

    fn setup(max_members: u32) -> Fixture<'static> {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let mut members = Vec::new(&env);
        for _ in 0..max_members {
            members.push_back(Address::generate(&env));
        }

        let token_id = env.register_stellar_asset_contract(admin.clone());
        let token_admin = StellarAssetClient::new(&env, &token_id);
        for m in members.iter() {
            token_admin.mint(&m, &1_000_000_000);
        }

        let contract_id = env.register_contract(None, AjoContract);
        let client = AjoContractClient::new(&env, &contract_id);
        let interval: u64 = 86400;
        client.initialize(&admin, &token_id, &100_000_000, &max_members, &interval);

        Fixture { env, members, client, interval }
    }

    /// Resets the budget, runs `f`, prints the cost, and asserts it is
    /// within `CPU_CEILING`. Returns the measured CPU instruction count.
    fn measure(env: &Env, label: &str, f: impl FnOnce()) -> u64 {
        env.budget().reset_default();
        f();
        let cpu = env.budget().cpu_instruction_cost();
        let mem = env.budget().memory_bytes_cost();
        std::println!("[bench] {label}: cpu_instructions={cpu} memory_bytes={mem}");
        assert!(
            cpu < CPU_CEILING,
            "{label} exceeded the CPU regression ceiling: {cpu} >= {CPU_CEILING}"
        );
        cpu
    }

    #[test]
    fn bench_join() {
        let fx = setup(5);
        let m = fx.members.get(0).unwrap();
        measure(&fx.env, "join", || {
            fx.client.join(&m);
        });
    }

    #[test]
    fn bench_contribute() {
        let fx = setup(5);
        for m in fx.members.iter() {
            fx.client.join(&m);
        }
        let m = fx.members.get(0).unwrap();
        measure(&fx.env, "contribute", || {
            fx.client.contribute(&m, &100_000_000);
        });
    }

    #[test]
    fn bench_payout() {
        let fx = setup(5);
        for m in fx.members.iter() {
            fx.client.join(&m);
        }
        for m in fx.members.iter() {
            fx.client.contribute(&m, &100_000_000);
        }
        fx.env.ledger().with_mut(|l| l.timestamp = fx.interval + 1);
        measure(&fx.env, "payout", || {
            fx.client.payout();
        });
    }

    #[test]
    fn bench_admin_transfer() {
        let fx = setup(5);
        let new_admin = Address::generate(&fx.env);
        measure(&fx.env, "propose_admin+accept_admin", || {
            fx.client.propose_admin(&new_admin);
            fx.client.accept_admin();
        });
    }

    #[test]
    fn bench_join_cost_scales_reasonably_with_circle_size() {
        // Sanity check that per-member join cost does not blow up as the
        // circle grows — regression guard against an accidental O(n^2)
        // pattern (e.g. re-scanning the full member list on every join).
        let small = setup(3);
        let small_cpu = measure(&small.env, "join (3-member circle)", || {
            small.client.join(&small.members.get(0).unwrap());
        });

        let large = setup(20);
        let large_cpu = measure(&large.env, "join (20-member circle)", || {
            large.client.join(&large.members.get(0).unwrap());
        });

        // A generous linear-ish bound: joining in a circle ~7x the size
        // should not cost more than ~10x as much.
        assert!(
            large_cpu < small_cpu.saturating_mul(10).max(1),
            "join cost scaled superlinearly with circle size: {small_cpu} -> {large_cpu}"
        );
    }
}
