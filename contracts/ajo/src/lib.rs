//! Ajosave Ajo Contract
//!
//! A trustless rotating savings circle (Ajo/Esusu) on Stellar Soroban.
//!
//! ## Lifecycle
//! 1. `initialize` — admin sets up the circle parameters
//! 2. `join`       — members join by locking their first contribution
//! 3. `contribute` — members pay each cycle
//! 4. `payout`     — admin triggers rotation payout after cycle time
//! 5. Circle completes when all members have received their payout
//!
//! ## Storage Optimization
//! - Instance storage: Core circle configuration (survives entire contract lifetime)
//! - Temporary storage: Contribution tracking (cleared when circle completes)
//! - Persistent storage: Member reputation records (cross-contract lifetime)

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, token, vec, Address, BytesN, Env, Symbol, Vec,
};

// ─── Schema version ───────────────────────────────────────────────────────────
/// Bump this constant whenever the storage layout changes in a new deployment.
/// `migrate()` uses it to gate and sequence migration logic.
const STORAGE_VERSION: u32 = 1;

// ─── TTL Configuration ────────────────────────────────────────────────────────
const DAY_IN_LEDGERS: u32 = 17280;
const INSTANCE_BUMP_AMOUNT: u32 = 7 * DAY_IN_LEDGERS;
const INSTANCE_LIFETIME_THRESHOLD: u32 = DAY_IN_LEDGERS;
const PERSISTENT_BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
const PERSISTENT_LIFETIME_THRESHOLD: u32 = 7 * DAY_IN_LEDGERS;

// ─── Upgrade governance ───────────────────────────────────────────────────────
/// Minimum delay (seconds) between `propose_upgrade` and a matching `upgrade`
/// call taking effect. Gives circle members visibility/time to react (e.g.
/// exit) before new contract logic goes live, instead of an admin being able
/// to swap the WASM instantly and unilaterally.
const UPGRADE_TIMELOCK_SECS: u64 = 172_800; // 48 hours

// ─── Storage keys ─────────────────────────────────────────────────────────────

/// Storage key classification for optimization:
/// - Instance: Core configuration (admin, token, amounts, members list, payout order)
///   Survives entire contract lifetime, extended via TTL bumping
/// - Temporary: Per-cycle contribution tracking, cleared on circle completion
///   Lower ledger fees as they expire automatically after TTL
/// - Persistent: Member reputation (cross-contract lifetime data)
#[contracttype]
pub enum DataKey {
    // ─── Instance storage (core circle configuration) ────────────────────────────
    Admin,
    PendingAdmin,
    PendingUpgradeHash,
    PendingUpgradeTime,
    Token,
    ContributionAmount,
    MaxMembers,
    CycleIntervalSecs,
    Members,
    PayoutOrder,
    CurrentCycle,
    NextPayoutTime,
    Completed,
    Paused,
    StorageVersion,
    TtlThreshold,
    TtlExtendTo,

    // ─── Temporary storage (per-cycle, cleared after completion) ─────────────────
    Contributions(Address, u32), // (member, cycle) → bool

    // ─── Persistent storage (member reputation, survives upgrades) ────────────────
    MemberReputation(Address),
    TotalCirclesCompleted(Address),
    OnTimeContributions(Address),
    TotalContributions(Address),

    // ─── Reentrancy guard (issue #264) - instance storage ────────────────────────
    PayoutLock,
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct AjoContract;

#[contractimpl]
impl AjoContract {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialize the circle.
    ///
    /// * `admin`               – address that controls admin operations
    /// * `token`               – USDC token contract address
    /// * `contribution_amount` – USDC amount per member per cycle (in stroops)
    /// * `max_members`         – total number of members (= total cycles)
    /// * `cycle_interval_secs` – seconds between payouts (e.g. 2592000 = 30 days)
    pub fn initialize(
        env: Env,
        admin: Address,
        token: Address,
        contribution_amount: i128,
        max_members: u32,
        cycle_interval_secs: u64,
    ) {
        Self::extend_instance_ttl(&env);
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        if max_members < 2 || max_members > 20 {
            panic!("max_members must be between 2 and 20");
        }
        if contribution_amount <= 0 {
            panic!("contribution_amount must be positive");
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::ContributionAmount, &contribution_amount);
        env.storage().instance().set(&DataKey::MaxMembers, &max_members);
        env.storage().instance().set(&DataKey::CycleIntervalSecs, &cycle_interval_secs);
        env.storage().instance().set(&DataKey::Members, &Vec::<Address>::new(&env));
        env.storage().instance().set(&DataKey::PayoutOrder, &Vec::<u32>::new(&env));
        env.storage().instance().set(&DataKey::CurrentCycle, &0u32);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::Completed, &false);

        env.events().publish(
            (Symbol::new(&env, "initialized"),),
            (admin, max_members, contribution_amount),
        );
    }

    // ── Member operations ─────────────────────────────────────────────────────

    /// Join the circle. Transfers the first contribution into the contract.
    pub fn join(env: Env, member: Address) {
        Self::extend_instance_ttl(&env);
        member.require_auth();

        let max_members: u32 = env.storage().instance().get(&DataKey::MaxMembers).expect("not initialized");
        let mut members: Vec<Address> = env.storage().instance().get(&DataKey::Members).expect("not initialized");
        let current_cycle: u32 = env.storage().instance().get(&DataKey::CurrentCycle).expect("not initialized");

        if current_cycle > 0 {
            panic!("circle already started");
        }
        if members.len() >= max_members {
            panic!("circle is full");
        }
        if members.contains(&member) {
            panic!("already a member");
        }

        let token: Address = env.storage().instance().get(&DataKey::Token).expect("not initialized");
        let amount: i128 = env.storage().instance().get(&DataKey::ContributionAmount).expect("not initialized");

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&member, &env.current_contract_address(), &amount);

        // Use temporary storage for contribution tracking (lower ledger fees)
        Self::set_temp_contribution(&env, &member, 1, true);

        members.push_back(member.clone());
        env.storage().instance().set(&DataKey::Members, &members);

        if members.len() == max_members {
            let interval: u64 = env.storage().instance().get(&DataKey::CycleIntervalSecs).expect("not initialized");
            let next_payout = env.ledger().timestamp() + interval;
            env.storage().instance().set(&DataKey::CurrentCycle, &1u32);
            env.storage().instance().set(&DataKey::NextPayoutTime, &next_payout);
            env.events().publish((Symbol::new(&env, "circle_started"),), (max_members, amount));
        }

        env.events().publish(
            (Symbol::new(&env, "member_joined"),),
            (member, amount),
        );
    }

    /// Contribute for the current cycle.
    ///
    /// The caller must pass the exact `ContributionAmount`; the contract
    /// rejects any other value to prevent under- and over-contributions.
    pub fn contribute(env: Env, member: Address, amount: i128) {
        Self::extend_instance_ttl(&env);
        member.require_auth();

        // Respect emergency pause
        let paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
        if paused {
            panic!("contract is paused");
        }

        let required: i128 = env.storage().instance().get(&DataKey::ContributionAmount).expect("not initialized");
        if amount != required {
            panic!("contribution amount must equal required amount");
        }

        let current_cycle: u32 = env.storage().instance().get(&DataKey::CurrentCycle).expect("not initialized");
        if current_cycle == 0 {
            panic!("circle not started yet");
        }

        let members: Vec<Address> = env.storage().instance().get(&DataKey::Members).expect("not initialized");
        if !members.contains(&member) {
            panic!("not a member");
        }

        // Check contribution using temporary storage
        let already_paid: bool = Self::get_temp_contribution(&env, &member, current_cycle);
        if already_paid {
            panic!("already contributed this cycle");
        }

        let token: Address = env.storage().instance().get(&DataKey::Token).expect("not initialized");
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&member, &env.current_contract_address(), &amount);

        // Store contribution in temporary storage (lower ledger fees)
        Self::set_temp_contribution(&env, &member, current_cycle, true);

        let next_payout_time: u64 = env.storage().instance().get(&DataKey::NextPayoutTime).expect("not initialized");
        let is_on_time = env.ledger().timestamp() < next_payout_time;

        if is_on_time {
            let on_time_count: u32 = env
                .storage()
                .persistent()
                .get(&DataKey::OnTimeContributions(member.clone()))
                .unwrap_or(0);
            env.storage()
                .persistent()
                .set(&DataKey::OnTimeContributions(member.clone()), &(on_time_count + 1));
        }

        let total: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::TotalContributions(member.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::TotalContributions(member.clone()), &(total + 1));

        Self::update_reputation(&env, &member);

        env.events().publish(
            (Symbol::new(&env, "contribution_made"),),
            (member, amount, current_cycle),
        );
    }

    // ── Admin operations ──────────────────────────────────────────────────────

    /// Set payout order. Admin-only.
    pub fn set_payout_order(env: Env, order: Vec<u32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        admin.require_auth();

        let current_cycle: u32 = env.storage().instance().get(&DataKey::CurrentCycle).expect("not initialized");
        if current_cycle > 0 {
            panic!("cannot set payout order after circle starts");
        }

        let max_members: u32 = env.storage().instance().get(&DataKey::MaxMembers).expect("not initialized");
        if order.len() != max_members {
            panic!("payout order length must equal max_members");
        }

        env.storage().instance().set(&DataKey::PayoutOrder, &order);
    }

    /// Trigger payout to the current cycle's recipient. Admin-only, callable after next_payout_time.
    ///
    /// # Security – Reentrancy Guard (issue #264)
    /// A `PayoutLock` flag is set at the start and cleared at the end.
    /// The contract follows checks-effects-interactions: all state mutations
    /// occur before the external token transfer.
    pub fn payout(env: Env) {
        Self::extend_instance_ttl(&env);

        // Respect emergency pause
        let paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
        if paused {
            panic!("contract is paused");
        }

        // ─── Reentrancy guard ─────────────────────────────────────────────────
        let locked: bool = env.storage().instance().get(&DataKey::PayoutLock).unwrap_or(false);
        if locked {
            panic!("payout already in progress");
        }
        env.storage().instance().set(&DataKey::PayoutLock, &true);

        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        admin.require_auth();

        let completed: bool = env.storage().instance().get(&DataKey::Completed).unwrap_or(false);
        if completed {
            panic!("circle already completed");
        }

        let current_cycle: u32 = env.storage().instance().get(&DataKey::CurrentCycle).expect("not initialized");
        if current_cycle == 0 {
            panic!("circle not started");
        }

        let next_payout_time: u64 = env.storage().instance().get(&DataKey::NextPayoutTime).expect("not initialized");
        if env.ledger().timestamp() < next_payout_time {
            panic!("payout time not reached");
        }

        let members: Vec<Address> = env.storage().instance().get(&DataKey::Members).expect("not initialized");
        let max_members: u32 = env.storage().instance().get(&DataKey::MaxMembers).expect("not initialized");

        for m in members.iter() {
            // Check contribution using temporary storage
            let paid: bool = Self::get_temp_contribution(&env, &m, current_cycle);
            if !paid {
                env.events().publish((Symbol::new(&env, "member_defaulted"),), (m, current_cycle));
            }
        }

        // Determine recipient from payout order (default: join order)
        let payout_order: Vec<u32> = {
            let stored: Vec<u32> = env
                .storage()
                .instance()
                .get(&DataKey::PayoutOrder)
                .unwrap_or(Vec::new(&env));
            if stored.is_empty() {
                let mut default_order = Vec::new(&env);
                for i in 0..max_members {
                    default_order.push_back(i);
                }
                default_order
            } else {
                stored
            }
        };

        let recipient_idx = payout_order.get(current_cycle - 1).expect("invalid cycle");
        let recipient = members.get(recipient_idx).expect("invalid member index");

        let token: Address = env.storage().instance().get(&DataKey::Token).expect("not initialized");
        let contribution: i128 = env.storage().instance().get(&DataKey::ContributionAmount).expect("not initialized");
        let pot = contribution * (max_members as i128);

        // ─── Effects before external call ─────────────────────────────────────
        if current_cycle >= max_members {
            env.storage().instance().set(&DataKey::Completed, &true);
            // Clear temporary contribution entries to reduce ledger footprint
            Self::clear_temp_contributions(&env, &members, max_members);
            for member in members.iter() {
                let circles_completed: u32 = env
                    .storage()
                    .persistent()
                    .get(&DataKey::TotalCirclesCompleted(member.clone()))
                    .unwrap_or(0);
                env.storage()
                    .persistent()
                    .set(&DataKey::TotalCirclesCompleted(member.clone()), &(circles_completed + 1));
                Self::update_reputation(&env, &member);
            }
        } else {
            let interval: u64 = env.storage().instance().get(&DataKey::CycleIntervalSecs).expect("not initialized");
            env.storage().instance().set(&DataKey::CurrentCycle, &(current_cycle + 1));
            env.storage().instance().set(&DataKey::NextPayoutTime, &(env.ledger().timestamp() + interval));
        }

        // ─── Interaction ──────────────────────────────────────────────────────
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &recipient, &pot);

        env.storage().instance().set(&DataKey::PayoutLock, &false);

        env.events().publish(
            (Symbol::new(&env, "payout_sent"),),
            (recipient.clone(), pot, current_cycle)
        );
        if current_cycle >= max_members {
            env.events().publish((Symbol::new(&env, "circle_completed"),), ());
        }
    }

    /// Internal: Calculate and update reputation score for a member
    /// Score is based on:
    /// - On-time contribution rate (70% weight)
    /// - Number of completed circles (30% weight)
    fn update_reputation(env: &Env, member: &Address) {
        let on_time: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::OnTimeContributions(member.clone()))
            .unwrap_or(0);
        let total: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::TotalContributions(member.clone()))
            .unwrap_or(1); // avoid division by zero
        let circles_completed: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::TotalCirclesCompleted(member.clone()))
            .unwrap_or(0);

        // On-time rate: 0-70 points
        let on_time_score = if total > 0 {
            (on_time * 70) / total
        } else {
            0
        };

        // Completed circles: 0-30 points (capped at 10 circles)
        let circles_score = if circles_completed >= 10 {
            30
        } else {
            circles_completed * 3
        };

        let reputation = on_time_score + circles_score;
        
        // Update storage and extend TTL for all persistent keys related to this member
        let keys = [
            DataKey::OnTimeContributions(member.clone()),
            DataKey::TotalContributions(member.clone()),
            DataKey::TotalCirclesCompleted(member.clone()),
            DataKey::MemberReputation(member.clone()),
        ];

        for key in keys.iter() {
            Self::extend_persistent_ttl(env, key);
        }

        env.storage()
            .persistent()
            .set(&DataKey::MemberReputation(member.clone()), &reputation);

        env.events().publish(
            (Symbol::new(&env, "reputation_updated"),),
            (member.clone(), reputation),
        );
    }

    /// Read-only: get reputation score for a member (0-100)
    pub fn get_reputation(env: Env, member: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::MemberReputation(member))
            .unwrap_or(0)
    }

    /// Read-only: get detailed reputation stats for a member
    pub fn get_reputation_stats(env: Env, member: Address) -> (u32, u32, u32, u32) {
        let reputation: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::MemberReputation(member.clone()))
            .unwrap_or(0);
        let circles_completed: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::TotalCirclesCompleted(member.clone()))
            .unwrap_or(0);
        let on_time: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::OnTimeContributions(member.clone()))
            .unwrap_or(0);
        let total: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::TotalContributions(member))
            .unwrap_or(0);

        (reputation, circles_completed, on_time, total)
    }

    /// Migrate storage layout after a contract upgrade. Admin-only.
    ///
    /// Call once immediately after `upgrade()` when the new WASM introduces
    /// storage layout changes. No-op if already at `STORAGE_VERSION`.
    ///
    /// To add a future migration: bump `STORAGE_VERSION` and add an
    /// `if from < N { … }` block below.
    pub fn migrate(env: Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        admin.require_auth();

        let from: u32 = env
            .storage()
            .instance()
            .get(&DataKey::StorageVersion)
            .unwrap_or(0);

        if from >= STORAGE_VERSION {
            return;
        }

        // ── v0 → v1 ──────────────────────────────────────────────────────────
        // Ensure PayoutLock is initialised on contracts upgraded from v0.
        if from < 1 {
            if !env.storage().instance().has(&DataKey::PayoutLock) {
                env.storage().instance().set(&DataKey::PayoutLock, &false);
            }
        }

        // ── Add future migration blocks here ─────────────────────────────────
        // if from < 2 { … }

        env.storage().instance().set(&DataKey::StorageVersion, &STORAGE_VERSION);

        env.events().publish((Symbol::new(&env, "migrated"),), (from, STORAGE_VERSION));
    }

    /// Propose an upgrade to `new_wasm_hash`. Admin-only.
    ///
    /// Starts the upgrade-governance timelock: the matching `upgrade` call
    /// cannot execute until `UPGRADE_TIMELOCK_SECS` has elapsed. Proposing a
    /// new hash replaces any previous pending proposal.
    pub fn propose_upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        admin.require_auth();

        let effective_at = env.ledger().timestamp() + UPGRADE_TIMELOCK_SECS;
        env.storage().instance().set(&DataKey::PendingUpgradeHash, &new_wasm_hash);
        env.storage().instance().set(&DataKey::PendingUpgradeTime, &effective_at);

        env.events().publish(
            (Symbol::new(&env, "upgrade_proposed"),),
            (new_wasm_hash, effective_at),
        );
    }

    /// Cancel a pending upgrade proposal. Admin-only. No-op if none pending.
    pub fn cancel_upgrade(env: Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        admin.require_auth();

        env.storage().instance().remove(&DataKey::PendingUpgradeHash);
        env.storage().instance().remove(&DataKey::PendingUpgradeTime);

        env.events().publish((Symbol::new(&env, "upgrade_cancelled"),), ());
    }

    /// Execute a previously proposed upgrade to `new_wasm_hash`. Admin-only.
    ///
    /// Requires a matching `propose_upgrade` call whose timelock
    /// (`UPGRADE_TIMELOCK_SECS`) has elapsed. This is the upgrade-governance
    /// boundary for #55: an admin can no longer swap the contract WASM in a
    /// single, immediate call.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        admin.require_auth();

        let pending_hash: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::PendingUpgradeHash)
            .expect("no pending upgrade proposed");
        if pending_hash != new_wasm_hash {
            panic!("new_wasm_hash does not match the pending upgrade proposal");
        }

        let effective_at: u64 = env
            .storage()
            .instance()
            .get(&DataKey::PendingUpgradeTime)
            .expect("no pending upgrade proposed");
        if env.ledger().timestamp() < effective_at {
            panic!("upgrade timelock has not elapsed");
        }

        env.storage().instance().remove(&DataKey::PendingUpgradeHash);
        env.storage().instance().remove(&DataKey::PendingUpgradeTime);

        env.deployer().update_current_contract_wasm(new_wasm_hash.clone());

        env.events().publish((Symbol::new(&env, "upgraded"),), (new_wasm_hash,));
    }

    /// Emergency pause — admin-only. Halts `contribute` and `payout`.
    pub fn pause(env: Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish((Symbol::new(&env, "paused"),), ());
    }

    /// Lift emergency pause — admin-only.
    pub fn unpause(env: Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish((Symbol::new(&env, "unpaused"),), ());
    }

    // ── Read-only ─────────────────────────────────────────────────────────────

    pub fn get_state(env: Env) -> (u32, u32, u64, bool) {
        let current_cycle: u32 = env.storage().instance().get(&DataKey::CurrentCycle).unwrap_or(0);
        let max_members: u32 = env.storage().instance().get(&DataKey::MaxMembers).unwrap_or(0);
        let next_payout_time: u64 = env.storage().instance().get(&DataKey::NextPayoutTime).unwrap_or(0);
        let completed: bool = env.storage().instance().get(&DataKey::Completed).unwrap_or(false);
        let paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
        (current_cycle, max_members, next_payout_time, completed, paused)
    }

    pub fn get_members(env: Env) -> Vec<Address> {
        env.storage().instance().get(&DataKey::Members).unwrap_or(vec![&env])
    }

    pub fn get_payout_order(env: Env) -> Vec<u32> {
        env.storage().instance().get(&DataKey::PayoutOrder).unwrap_or(vec![&env])
    }

    /// Read-only: get contribution status for every member in a given cycle.
    ///
    /// Returns a `Vec` of `(Address, bool)` tuples — one per member — where
    /// `true` means the member has contributed for `cycle` and `false` means
    /// they have not yet (or defaulted).
    pub fn get_contribution_status(env: Env, cycle: u32) -> Vec<(Address, bool)> {
        let members: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Members)
            .unwrap_or(Vec::new(&env));

        let mut result: Vec<(Address, bool)> = Vec::new(&env);
        for member in members.iter() {
            // Read from temporary storage
            let paid: bool = Self::get_temp_contribution(&env, &member, cycle);
            result.push_back((member, paid));
        }
        result
    }

    /// Propose a new admin. Only the current admin can call this.
    /// The proposed admin must call `accept_admin` to complete the transfer.
    pub fn propose_admin(env: Env, new_admin: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        admin.require_auth();
        env.storage().instance().set(&DataKey::PendingAdmin, &new_admin);
        env.events().publish((Symbol::new(&env, "admin_proposed"),), (admin, new_admin));
    }

    /// Accept the admin role. Only the pending admin can call this.
    pub fn accept_admin(env: Env) {
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .expect("no pending admin");
        pending.require_auth();
        let old_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        env.storage().instance().set(&DataKey::Admin, &pending);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        env.events().publish((Symbol::new(&env, "admin_transferred"),), (old_admin, pending));
    }

    /// Set TTL configuration. Admin-only.
    pub fn set_ttl_config(env: Env, threshold: u32, extend_to: u32) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        admin.require_auth();

        env.storage().instance().set(&DataKey::TtlThreshold, &threshold);
        env.storage().instance().set(&DataKey::TtlExtendTo, &extend_to);
    }

    /// Set contribution status in temporary storage (expires when circle completes)
    /// This reduces ledger footprint compared to instance storage.
    fn set_temp_contribution(env: &Env, member: &Address, cycle: u32, contributed: bool) {
        env.storage().temporary().set(&DataKey::Contributions(member.clone(), cycle), &contributed);
    }

    /// Get contribution status from temporary storage
    fn get_temp_contribution(env: &Env, member: &Address, cycle: u32) -> bool {
        env.storage().temporary().get(&DataKey::Contributions(member.clone(), cycle)).unwrap_or(false)
    }

    /// Clear all temporary contribution entries (call when circle completes)
    fn clear_temp_contributions(env: &Env, members: &Vec<Address>, max_members: u32) {
        for cycle in 1..=max_members {
            for member in members.iter() {
                env.storage().temporary().remove(&DataKey::Contributions(member.clone(), cycle));
            }
        }
    }

    fn extend_instance_ttl(env: &Env) {
        let threshold = env.storage().instance().get(&DataKey::TtlThreshold).unwrap_or(INSTANCE_LIFETIME_THRESHOLD);
        let extend_to = env.storage().instance().get(&DataKey::TtlExtendTo).unwrap_or(INSTANCE_BUMP_AMOUNT);

        env.storage()
            .instance()
            .extend_ttl(threshold, extend_to);
    }

    /// Extend TTL for temporary storage entries when needed
    /// Temporary storage uses lower TTL defaults for automatic cleanup
    fn extend_temp_storage_ttl(env: &Env, member: &Address, cycle: u32) {
        let temp_entry = DataKey::Contributions(member.clone(), cycle);
        env.storage().temporary().extend_ttl(&temp_entry, DAY_IN_LEDGERS, 7 * DAY_IN_LEDGERS);
    }

    fn extend_persistent_ttl(env: &Env, key: &DataKey) {
        env.storage()
            .persistent()
            .extend_ttl(key, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
    }

    /// Test-only helper: force the payout lock to a given value.
    /// Used to simulate a re-entrant call in the Soroban sandbox.
    #[cfg(test)]
    pub fn set_payout_lock(env: Env, locked: bool) {
        env.storage().instance().set(&DataKey::PayoutLock, &locked);
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{Client as TokenClient, StellarAssetClient},
        Env,
    };

    fn setup(env: &Env) -> (Address, Vec<Address>, Address, TokenClient<'_>, AjoContractClient<'_>) {
        let admin = Address::generate(env);
        let members = vec![
            env,
            Address::generate(env),
            Address::generate(env),
            Address::generate(env),
        ];

        let token_id = env.register_stellar_asset_contract(admin.clone());
        let token = TokenClient::new(env, &token_id);
        let token_admin = StellarAssetClient::new(env, &token_id);

        for m in members.iter() {
            token_admin.mint(m, &1_000_000_000);
        }

        let contract_id = env.register_contract(None, AjoContract);
        let client = AjoContractClient::new(env, &contract_id);

        client.initialize(&admin, &token_id, &100_000_000, &3, &86400);

        (admin, members, token_id, token, client)
    }

    #[test]
    fn test_contribution_storage_uses_temporary() {
        let env = Env::default();
        env.mock_all_auths();
        let (_, members, _, _, client) = setup(&env);

        for m in members.iter() { client.join(m); }

        // Check that contribution is stored in temporary storage
        let member = members.get(0).unwrap();
        let has_temp = env.storage().temporary().has(&DataKey::Contributions(member.clone(), 1));
        assert!(has_temp, "contribution should be in temporary storage after join");

        // Verify reading via get_contribution_status works
        let status = client.get_contribution_status(&1u32);
        let (_, paid) = status.get(0).unwrap();
        assert!(paid, "member should show as contributed for cycle 1");
    }

    #[test]
    fn test_full_cycle() {
        use soroban_sdk::{testutils::Events, TryFromVal};

        let env = Env::default();
        env.mock_all_auths();
        let (_, members, _, token, client) = setup(&env);

        for m in members.iter() { client.join(m); }

        let (cycle, max, _, completed, _) = client.get_state();
        assert_eq!(cycle, 1);
        assert_eq!(max, 3);
        assert!(!completed);

        // Verify circle_started event when last member joins
        let started_sym = Symbol::new(&env, "circle_started");
        let found_started = env.events().all().iter().any(|(_, topics, _)| {
            if topics.len() != 1 { return false; }
            let Ok(sym) = Symbol::try_from_val(&env, &topics.get(0).unwrap()) else { return false; };
            sym == started_sym
        });
        assert!(found_started, "circle_started event should be emitted when circle fills");

        env.ledger().with_mut(|l| l.timestamp = 86401);
        client.payout();
        assert_eq!(token.balance(&members.get(0).unwrap()), 1_100_000_000);

        // Verify payout_sent event
        let payout_sym = Symbol::new(&env, "payout_sent");
        let found_payout = env.events().all().iter().any(|(_, topics, _)| {
            if topics.len() != 1 { return false; }
            let Ok(sym) = Symbol::try_from_val(&env, &topics.get(0).unwrap()) else { return false; };
            sym == payout_sym
        });
        assert!(found_payout, "payout_sent event should be emitted");

        for m in members.iter() { client.contribute(m, &100_000_000); }
        env.ledger().with_mut(|l| l.timestamp = 172802);
        client.payout();

        for m in members.iter() { client.contribute(m, &100_000_000); }
        env.ledger().with_mut(|l| l.timestamp = 259203);
        client.payout();

        let (_, _, _, completed, _) = client.get_state();
        assert!(completed);

        // Verify circle_completed event on final payout
        let completed_sym = Symbol::new(&env, "circle_completed");
        let found_completed = env.events().all().iter().any(|(_, topics, _)| {
            if topics.len() != 1 { return false; }
            let Ok(sym) = Symbol::try_from_val(&env, &topics.get(0).unwrap()) else { return false; };
            sym == completed_sym
        });
        assert!(found_completed, "circle_completed event should be emitted on final payout");

        // Verify temporary contributions are cleared after completion
        let has_temp = env.storage().temporary().has(&DataKey::Contributions(members.get(0).unwrap().clone(), 1));
        assert!(!has_temp, "temporary contributions should be cleared after circle completes");
    }

    #[test]
    #[should_panic(expected = "already contributed this cycle")]
    fn test_double_contribute_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (_, members, _, _, client) = setup(&env);
        for m in members.iter() { client.join(m); }
        client.contribute(&members.get(0).unwrap(), &100_000_000);
    }

    #[test]
    fn test_defaulted_event() {
        use soroban_sdk::{testutils::Events, TryFromVal};

        let env = Env::default();
        env.mock_all_auths();
        let (_, members, _, _, client) = setup(&env);

        for m in members.iter() { client.join(m); }

        env.ledger().with_mut(|l| l.timestamp = 86401);
        client.payout();

        // members[0] and members[1] contribute for cycle 2; members[2] defaults
        client.contribute(&members.get(0).unwrap(), &100_000_000);
        client.contribute(&members.get(1).unwrap(), &100_000_000);

        env.ledger().with_mut(|l| l.timestamp = 172802);
        client.payout();

        let defaulter = members.get(2).unwrap();
        let defaulted_sym = Symbol::new(&env, "member_defaulted");

        let found = env.events().all().iter().any(|(_, topics, data)| {
            if topics.len() != 1 { return false; }
            let Ok(sym) = Symbol::try_from_val(&env, &topics.get(0).unwrap()) else { return false; };
            if sym != defaulted_sym { return false; }
            let Ok((addr, cycle)) = <(Address, u32)>::try_from_val(&env, data) else { return false; };
            addr == defaulter && cycle == 2
        });

        assert!(found, "no 'member_defaulted' event emitted for members[2] on cycle 2");
    }

    #[test]
    fn test_ttl_extension() {
        let env = Env::default();
        env.mock_all_auths();
        let (_, members, _, _, client) = setup(&env);

        client.set_ttl_config(&10, &100);
        client.join(&members.get(0).unwrap());
        env.ledger().with_mut(|l| l.sequence = 50);

        let (cycle, _, _, _, _) = client.get_state();
        assert_eq!(cycle, 0);
    }

    #[test]
    fn test_get_contribution_status() {
        let env = Env::default();
        env.mock_all_auths();
        let (_, members, _, _, client) = setup(&env);

        for m in members.iter() { client.join(m); }

        let status = client.get_contribution_status(&1u32);
        assert_eq!(status.len(), 3);
        for (_, paid) in status.iter() { assert!(paid); }

        env.ledger().with_mut(|l| l.timestamp = 86401);
        client.payout();

        let status2 = client.get_contribution_status(&2u32);
        for (_, paid) in status2.iter() { assert!(!paid); }

        client.contribute(&members.get(0).unwrap(), &100_000_000);
        let status3 = client.get_contribution_status(&2u32);
        let (_, m0_paid) = status3.get(0).unwrap();
        let (_, m1_paid) = status3.get(1).unwrap();
        assert!(m0_paid);
        assert!(!m1_paid);
    }

    #[test]
    fn test_payout_state_advancement() {
        let env = Env::default();
        env.mock_all_auths();
        let (_, members, _, _, client) = setup(&env);

        for m in members.iter() { client.join(m); }
        env.ledger().with_mut(|l| l.timestamp = 86401);

        let (cycle, _, _, completed, _) = client.get_state();
        assert_eq!(cycle, 1);
        assert!(!completed);

        client.payout();

        let (cycle, _, _, completed, _) = client.get_state();
        assert_eq!(cycle, 2);
        assert!(!completed);
    }

    #[test]
    fn test_propose_and_accept_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let (_, _, _, _, client) = setup(&env);
        let new_admin = Address::generate(&env);
        client.propose_admin(&new_admin);
        client.accept_admin();
    }

    #[test]
    #[should_panic(expected = "no pending admin")]
    fn test_accept_admin_without_proposal_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (_, _, _, _, client) = setup(&env);
        client.accept_admin();
    }
}

#[cfg(test)]
mod integration_tests;

#[cfg(test)]
mod benchmarks;

#[cfg(test)]
mod fuzz_tests;
