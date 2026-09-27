# Contract Fuzzing

## Overview

Ajosave runs two complementary fuzzing strategies against the Ajo Soroban contract:

| Strategy | Tool | When |
|---|---|---|
| Property-based fuzz tests | `cargo test` (existing `fuzz_tests.rs`) | Every CI push/PR |
| libFuzzer coverage-guided fuzzing | `cargo-fuzz` | Nightly scheduled workflow + on-demand |

## Files

```
.github/workflows/contract-fuzz.yml   # Scheduled workflow
contracts/ajo/fuzz/
├── Cargo.toml                        # cargo-fuzz crate
└── fuzz_targets/
    ├── fuzz_contribute.rs            # Contribution boundary & overflow checks
    ├── fuzz_join.rs                  # Join validation (negative/zero/over-capacity)
    └── fuzz_payout.rs                # Payout rotation & timing guards
```

## Running Locally

### Property-based tests (fast, no extra tooling)

```bash
npm run contract:test
# or directly:
cd contracts && cargo test --package ajo fuzz -- --nocapture
```

### libFuzzer targets (requires nightly Rust)

```bash
rustup install nightly
cargo install cargo-fuzz --locked

cd contracts/ajo

# Run a specific target for 60 seconds
cargo +nightly fuzz run fuzz_contribute -- -max_total_time=60
cargo +nightly fuzz run fuzz_join       -- -max_total_time=60
cargo +nightly fuzz run fuzz_payout     -- -max_total_time=60
```

### Reproducing a crash

If the scheduled workflow files an issue and attaches crash artefacts:

```bash
# Download the artefact, then:
cargo +nightly fuzz run fuzz_contribute path/to/crash-file
```

## Interpreting Results

- **Property tests**: A test failure means a known invariant was violated. Fix the contract logic and add a targeted regression case in `contracts/ajo/src/fuzz_tests.rs`.
- **libFuzzer crash**: A crash indicates a previously unknown panic path. The crash input is the minimal reproducer. Analyse with `RUST_BACKTRACE=1`.

## CI Integration

The `contract-fuzz.yml` workflow:

1. Runs property fuzz tests on every nightly cron at 02:00 UTC.
2. Runs all three libFuzzer targets for 60 seconds each (configurable via `workflow_dispatch`).
3. Uploads corpus and crash artefacts (retained 30 days).
4. Automatically files a GitHub issue if any step fails.

## Adding New Targets

1. Create `contracts/ajo/fuzz/fuzz_targets/fuzz_<name>.rs`.
2. Add the `[[bin]]` entry to `contracts/ajo/fuzz/Cargo.toml`.
3. Add the target name to the `matrix.target` list in `.github/workflows/contract-fuzz.yml`.
4. Run `cargo +nightly fuzz run fuzz_<name> -- -max_total_time=30` locally before pushing.
