import {
  Horizon,
  Keypair,
  Asset,
  TransactionBuilder,
  Operation,
  BASE_FEE,
  Networks,
} from "@stellar/stellar-sdk";
import { serverConfig } from "@/server/config";
import { stellarBreaker } from "@/lib/circuit-breaker";

const server = new Horizon.Server(serverConfig.stellar.horizonUrl);
const USDC = new Asset(serverConfig.usdc.assetCode, serverConfig.usdc.issuer);
const networkPassphrase =
  serverConfig.stellar.network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

export async function sendUsdcPayment(destination: string, amount: string): Promise<string> {
  return stellarBreaker.execute(async () => {
    const keypair = Keypair.fromSecret(serverConfig.stellar.serverSecretKey);
    const account = await server.loadAccount(keypair.publicKey());

    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
      .addOperation(Operation.payment({ destination, asset: USDC, amount }))
      .setTimeout(30)
      .build();

    tx.sign(keypair);
    const result = await server.submitTransaction(tx);
    return result.hash;
  });
}

export async function getUsdcBalance(publicKey: string): Promise<string> {
  try {
    const account = await server.loadAccount(publicKey);
    const bal = account.balances.find(
      (b) =>
        b.asset_type !== "native" &&
        (b as { asset_code: string }).asset_code === serverConfig.usdc.assetCode
    );
    return bal?.balance ?? "0";
  } catch {
    return "0";
  }
}

export { server as horizonServer, USDC, networkPassphrase };
