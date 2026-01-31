import { GelatoRelay } from "@gelatonetwork/relay-sdk";
import { encodeFunctionData, parseUnits, type Hex } from "viem";
import { base } from "viem/chains";

const relay = new GelatoRelay();
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

const erc20Abi = [
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export async function sendGaslessUSDC({
  to,
  amount,
  userAddress,
}: {
  to: string;
  amount: string;
  userAddress: string;
}) {
  console.log('[Gelato] Preparing gasless USDC transfer:', {
    to,
    amount,
    from: userAddress,
  });

  // Encode USDC transfer call
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [to as Hex, parseUnits(amount, 6)],
  });

  try {
    // Execute via Gelato Relay with sponsored gas
    const response = await relay.sponsoredCallERC2771(
      {
        chainId: base.id,
        target: USDC_ADDRESS,
        data,
        user: userAddress,
      },
      process.env.NEXT_PUBLIC_GELATO_API_KEY!
    );

    console.log('[Gelato] Transaction submitted:', response.taskId);

    return {
      taskId: response.taskId,
      status: "pending" as const,
    };
  } catch (error) {
    console.error('[Gelato] Failed to send gasless transaction:', error);
    throw error;
  }
}

/**
 * Check the status of a Gelato relay task
 */
export async function checkTaskStatus(taskId: string) {
  try {
    const response = await fetch(
      `https://api.gelato.digital/tasks/status/${taskId}`
    );
    const data = await response.json();

    return {
      taskId: data.taskId,
      status: data.taskState, // "pending" | "success" | "cancelled" | "failed"
      transactionHash: data.transactionHash,
      blockNumber: data.blockNumber,
    };
  } catch (error) {
    console.error('[Gelato] Failed to check task status:', error);
    throw error;
  }
}
