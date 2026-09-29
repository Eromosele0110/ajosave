import { contract, Keypair, Networks } from "@stellar/stellar-sdk";
import { serverConfig } from "@/server/config";
import { wrapWithFeeBump } from "@/lib/stellar";
import { safeFetch } from "@/lib/ssrf";
import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";

const networkPassphrase =
  serverConfig.stellar.network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

const rpcUrl = serverConfig.stellar.sorobanRpcUrl;
const networkFlag =
  serverConfig.stellar.network === "mainnet"
    ? `--network-passphrase "Public Global Stellar Network ; September 2015"`
    : `--network-passphrase "Test SDF Network ; September 2015"`;

/**
 * Fetch contract events from Soroban RPC for indexing and auditing.
 * Filters events by contract ID and optionally by start ledger.
 *
 * @param contractId - The contract to fetch events for
 * @param startLedger - Optional ledger number to start from (for pagination)
 * @param pageSize - Maximum number of events to return (default 100)
 * @returns Array of events with topic, value, and metadata
 */
export async function getContractEvents(
  contractId: string,
  startLedger?: number,
  pageSize: number = 100
): Promise<ContractEvent[]> {
  const response = await safeFetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getEvents",
      params: {
        start: {
          ledger: startLedger ?? 0,
          pagingToken: "0",
        },
        filters: [
          {
            contractId,
            ...(startLedger ? { startLedger } : {}),
          },
        ],
        limit: pageSize,
      },
    }),
  });

  const result = await response.json();
  if (result.error) {
    throw new Error(`RPC error: ${result.error.message}`);
  }

  return result.result.events.map((e: any) => ({
    topic: e.topic,
    value: e.value,
    ledger: e.ledger,
    timestamp: e.timestamp,
    transactionHash: e.transactionHash,
  }));
}

/**
 * Process contract events for backend indexing.
 * Parses event topics and routes to appropriate handlers.
 */
export async function processContractEvents(
  contractId: string,
  lastProcessedLedger?: number
): Promise<void> {
  const events = await getContractEvents(contractId, lastProcessedLedger);

  for (const event of events) {
    const topic = event.topic?.[0];
    if (!topic) continue;

    switch (topic) {
      case "member_joined":
        await handleMemberJoined(event.value);
        break;
      case "contribution_made":
        await handleContributionMade(event.value);
        break;
      case "payout_sent":
        await handlePayoutSent(event.value);
        break;
      case "circle_completed":
        await handleCircleCompleted(event.value);
        break;
      case "member_defaulted":
        await handleMemberDefaulted(event.value);
        break;
    }
  }
}

async function handleMemberJoined(value: any): Promise<void> {
  // TODO: Update backend state for member join
  console.log("[Event] member_joined:", value);
}

async function handleContributionMade(value: any): Promise<void> {
  // TODO: Update contribution tracking
  console.log("[Event] contribution_made:", value);
}

async function handlePayoutSent(value: any): Promise<void> {
  // TODO: Create payout record from event
  console.log("[Event] payout_sent:", value);
}

async function handleCircleCompleted(value: any): Promise<void> {
  // TODO: Mark circle as completed
  console.log("[Event] circle_completed:", value);
}

async function handleMemberDefaulted(value: any): Promise<void> {
  // TODO: Mark member as defaulted
  console.log("[Event] member_defaulted:", value);
}

export interface ContractEvent {
  topic: string[];
  value: any;
  ledger: number;
  timestamp: number;
  transactionHash: string;
}

/**
 * Deploy a new Ajo contract instance via the Stellar CLI.
 * Returns the deployed contract ID.
 *
 * Estimated deploy cost: ~0.01 XLM in transaction fees on testnet.
 * On mainnet, expect ~0.01–0.05 XLM depending on network congestion.
 */
export async function deployAjoContract(): Promise<string> {
  const wasmPath = path.resolve(
    process.cwd(),
    "contracts/target/wasm32-unknown-unknown/release/ajosave_ajo.wasm"
  );

  if (!fs.existsSync(wasmPath)) {
    throw new Error(
      "Ajo contract WASM not found. Run `npm run contract:build` first."
    );
  }

  const sourceKey = serverConfig.stellar.serverSecretKey;
  if (!sourceKey) {
    throw new Error("STELLAR_SERVER_SECRET_KEY is not set.");
  }

  const output = execSync(
    `stellar contract deploy --wasm ${wasmPath} --source ${sourceKey} --rpc-url ${rpcUrl} ${networkFlag}`,
    { encoding: "utf-8" }
  );

  const contractId = output.trim();
  if (!contractId) {
    throw new Error("Contract deployment returned empty contract ID.");
  }

  console.info(`[Soroban] Deployed new Ajo contract: ${contractId}`);
  return contractId;
}

/**
 * Invoke AjoContract.payout() via Soroban RPC.
 * The contract handles the token transfer; the backend only triggers it.
 *
 * @param contractId - The deployed Ajo contract address for this circle
 * @returns The Soroban transaction hash
 */
export async function invokeContractPayout(contractId: string): Promise<string> {
  const keypair = Keypair.fromSecret(serverConfig.stellar.serverSecretKey);
  const signer = contract.basicNodeSigner(keypair, networkPassphrase);

  const client = await contract.Client.from({
    contractId,
    networkPassphrase,
    rpcUrl: serverConfig.stellar.sorobanRpcUrl,
    publicKey: keypair.publicKey(),
    ...signer,
  });

  // payout() takes no args — admin auth is checked inside the contract
  // @ts-expect-error — method generated from contract ABI at runtime
  const assembled = await client.payout();
  
  // Wrap the inner transaction in a platform fee bump so users need no XLM
  const innerXdr: string = assembled.toXDR();
  return wrapWithFeeBump(innerXdr);
}

/**
 * Invoke AjoContract.set_payout_order() via Soroban RPC.
 * Sets the randomized payout order on the smart contract.
 *
 * @param contractId - The deployed Ajo contract address for this circle
 * @param payoutOrder - Array of member indices in desired payout order
 * @returns The Soroban transaction hash
 */
export async function invokeContractSetPayoutOrder(
  contractId: string,
  payoutOrder: number[]
): Promise<string> {
  const keypair = Keypair.fromSecret(serverConfig.stellar.serverSecretKey);
  const signer = contract.basicNodeSigner(keypair, networkPassphrase);

  const client = await contract.Client.from({
    contractId,
    networkPassphrase,
    rpcUrl: serverConfig.stellar.sorobanRpcUrl,
    publicKey: keypair.publicKey(),
    ...signer,
  });

  // set_payout_order(order: Vec<u32>)
  // @ts-expect-error — method generated from contract ABI at runtime
  const assembled = await client.set_payout_order({ order: payoutOrder });
  
  // Wrap the inner transaction in a platform fee bump so users need no XLM
  const innerXdr: string = assembled.toXDR();
  return wrapWithFeeBump(innerXdr);
}
