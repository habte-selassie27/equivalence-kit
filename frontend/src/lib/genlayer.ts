import { CONTRACT_ADDRESS } from "../config";
import { REASONS } from "../messages";

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
}

export interface WalletState {
  status: "no-provider" | "disconnected" | "connecting" | "wrong-network" | "connected";
  address?: string;
}

interface LeaderReceipt {
  execution_result?: string;
  result?: { status?: string; payload?: string };
}

export interface ReceiptLike {
  statusName?: string;
  status_name?: string;
  result_name?: string;
  consensus_data?: { leader_receipt?: LeaderReceipt[] };
}

export interface TxState {
  phase: "idle" | "signing" | "submitted" | "tracking" | "finalized" | "failed";
  hash?: string;
  status?: string;
  error?: string;
  reason?: string;
}

interface ChainClient {
  readContract(args: {
    address: `0x${string}`;
    functionName: string;
    args?: unknown[];
  }): Promise<unknown>;
  writeContract(args: {
    address: `0x${string}`;
    functionName: string;
    args?: unknown[];
    value: bigint;
  }): Promise<`0x${string}`>;
  getTransaction(args: { hash: string }): Promise<{ statusName?: string; status_name?: string }>;
  waitForTransactionReceipt(args: {
    hash: string;
    status?: string;
    interval?: number;
    retries?: number;
  }): Promise<ReceiptLike>;
  connect(network?: string): Promise<void>;
}

interface Sdk {
  createClient(config: {
    chain?: unknown;
    account?: `0x${string}`;
    provider?: Eip1193Provider;
  }): ChainClient;
}

interface SdkTypes {
  studionet: unknown;
  TransactionStatus: { FINALIZED: string };
}

let sdkPromise: Promise<{ sdk: Sdk; types: SdkTypes }> | null = null;

export function loadSdk(): Promise<{ sdk: Sdk; types: SdkTypes }> {
  if (!sdkPromise) {
    sdkPromise = Promise.all([
      import("genlayer-js"),
      import("genlayer-js/chains"),
      import("genlayer-js/types"),
    ]).then(([sdkMod, chainMod, typeMod]) => ({
      sdk: sdkMod as unknown as Sdk,
      types: {
        studionet: (chainMod as unknown as { studionet: unknown }).studionet,
        TransactionStatus: (typeMod as unknown as {
          TransactionStatus: SdkTypes["TransactionStatus"];
        }).TransactionStatus,
      },
    }));
  }
  return sdkPromise;
}

export function getEthereum(): Eip1193Provider | null {
  const injected = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  return injected ?? null;
}

export async function getReadClient(): Promise<ChainClient> {
  const { sdk, types } = await loadSdk();
  return sdk.createClient({ chain: types.studionet });
}

export async function connectWallet(): Promise<WalletState> {
  const injected = getEthereum();
  if (!injected) return { status: "no-provider" };
  try {
    const accounts = (await injected.request({ method: "eth_requestAccounts" })) as string[];
    const address = accounts?.[0];
    if (!address) return { status: "disconnected" };
    const client = await getReadClient();
    try {
      await client.connect("studionet");
    } catch {
      return { status: "wrong-network", address };
    }
    return { status: "connected", address };
  } catch {
    return { status: "disconnected" };
  }
}

export async function readRecord(wallet: string): Promise<Record<string, unknown> | null> {
  const client = await getReadClient();
  const raw = await client.readContract({
    address: CONTRACT_ADDRESS,
    functionName: "get_record",
    args: [wallet],
  });
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function readWallet(username: string): Promise<string> {
  const client = await getReadClient();
  const raw = await client.readContract({
    address: CONTRACT_ADDRESS,
    functionName: "get_wallet",
    args: [username],
  });
  return typeof raw === "string" ? raw : "";
}

function leaderReceipt(receipt: ReceiptLike): LeaderReceipt | undefined {
  return receipt.consensus_data?.leader_receipt?.[0];
}

export function executionFailed(receipt: ReceiptLike): boolean {
  const leader = leaderReceipt(receipt);
  return leader?.execution_result === "ERROR" || leader?.result?.status === "rollback";
}

export function reasonFromReceipt(receipt: ReceiptLike): string | undefined {
  const payload = leaderReceipt(receipt)?.result?.payload;
  if (typeof payload === "string" && (REASONS as readonly string[]).includes(payload)) {
    return payload;
  }
  const text = JSON.stringify(receipt);
  return REASONS.find((code) => text.includes(code));
}

export async function verifyOnChain(
  username: string,
  gistId: string,
  onState: (state: TxState) => void,
): Promise<TxState> {
  const state: TxState = { phase: "signing" };
  onState({ ...state });

  const injected = getEthereum();
  if (!injected) {
    state.phase = "failed";
    state.error = "No browser wallet was found. Install or unlock one and try again.";
    onState({ ...state });
    return state;
  }

  try {
    const accounts = (await injected.request({ method: "eth_accounts" })) as string[];
    const address = accounts?.[0];
    if (!address) {
      state.phase = "failed";
      state.error = "The wallet is not connected. Connect it and try again.";
      onState({ ...state });
      return state;
    }

    const { sdk, types } = await loadSdk();
    const client = sdk.createClient({
      chain: types.studionet,
      account: address as `0x${string}`,
      provider: injected,
    });
    try {
      await client.connect("studionet");
    } catch {
      state.phase = "failed";
      state.error = "Switch your wallet to StudioNet and try again.";
      onState({ ...state });
      return state;
    }

    const hash = await client.writeContract({
      address: CONTRACT_ADDRESS,
      functionName: "verify",
      args: [username, gistId],
      value: 0n,
    });
    state.phase = "submitted";
    state.hash = hash;
    onState({ ...state });

    const readClient = await getReadClient();
    const poll = window.setInterval(async () => {
      try {
        const tx = await readClient.getTransaction({ hash });
        const status = tx.statusName ?? tx.status_name;
        if (status) {
          state.phase = "tracking";
          state.status = status;
          onState({ ...state });
        }
      } catch {
        // A transient status read does not change the transaction.
      }
    }, 4000);

    try {
      const receipt = await readClient.waitForTransactionReceipt({
        hash,
        status: types.TransactionStatus.FINALIZED,
        interval: 4000,
        retries: 150,
      });
      state.status = receipt.status_name ?? receipt.statusName ?? "FINALIZED";
      if (executionFailed(receipt)) {
        state.phase = "failed";
        state.reason = reasonFromReceipt(receipt);
        onState({ ...state });
        return state;
      }
      state.phase = "finalized";
      onState({ ...state });
      return state;
    } finally {
      window.clearInterval(poll);
    }
  } catch (error) {
    state.phase = "failed";
    state.error = describeError(error);
    onState({ ...state });
    return state;
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as { shortMessage?: string; message?: string };
    if (candidate.shortMessage) return candidate.shortMessage;
    if (candidate.message) return candidate.message;
  }
  return "The wallet or network rejected the request. Check the wallet and try again.";
}
