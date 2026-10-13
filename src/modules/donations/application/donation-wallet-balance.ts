import { createPublicClient, formatUnits, http } from "viem";
import { base } from "viem/chains";

/**
 * USDC on Base — the asset the public donation page collects into the receiver wallet.
 * ID and decimals for the canonical Base USDC contract.
 */
const USDC_ON_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_DECIMALS = 6;

const DEFAULT_PUBLIC_RPC = "https://mainnet.base.org";

/**
 * Public (read-only) balance of the donation receiver wallet. No secret or key is
 * needed to read a public wallet's token balance — viem talks to the public Base RPC.
 * Returns null if the address is not configured or the chain is unreachable, so a
 * reporting page can degrade gracefully instead of throwing.
 */
export async function readDonationWalletBalanceUsdMinor(options?: {
  rpcUrl?: string;
  receiverAddress?: string;
}): Promise<bigint | null> {
  const receiver = options?.receiverAddress;
  if (!receiver || !/^0x[a-fA-F0-9]{40}$/.test(receiver)) return null;

  const rpcUrl = options?.rpcUrl || process.env.BASE_PUBLIC_RPC_URL || DEFAULT_PUBLIC_RPC;
  try {
    const client = createPublicClient({ chain: base, transport: http(rpcUrl) });
    const raw = await client.readContract({
      address: USDC_ON_BASE,
      abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }] }],
      functionName: "balanceOf",
      args: [receiver as `0x${string}`],
    });
    // viem returns bigint; normalise to a canonical bigint minor amount.
    const parsed = typeof raw === "bigint" ? raw : BigInt(String(raw ?? 0));
    return toUsdMinor(parsed, USDC_DECIMALS);
  } catch {
    return null;
  }
}

/** Convert a raw token balance (given its decimals) into a USD minor (cents) value. */
export function toUsdMinor(rawBalance: bigint, decimals: number): bigint {
  if (rawBalance <= 0n) return 0n;
  const scale = BigInt(10 ** decimals);
  const whole = rawBalance / scale;
  const fraction = (rawBalance % scale) * 100n / scale;
  return whole * 100n + fraction;
}

export function usdMinorToDisplay(minor: bigint): string {
  return formatUnits(minor, 2);
}
