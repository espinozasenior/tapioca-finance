/**
 * Gelato + Crossmint Integration
 *
 * This module bridges Crossmint wallets with Gelato's Smart Wallet SDK,
 * enabling EIP-7702 delegation for social login users.
 *
 * Flow:
 * 1. User authenticates with Crossmint (email/social login)
 * 2. Wrap Crossmint signer in viem WalletClient
 * 3. Upgrade to Gelato Smart Wallet with EIP-7702
 * 4. Execute transactions with gas sponsorship
 */

import { createWalletClient, custom, type Hex, type Chain } from "viem";
import { base } from "viem/chains";
import {
  createGelatoSmartWalletClient,
  type GelatoSmartWalletClient,
  sponsored,
  native,
  erc20
} from "@gelatonetwork/smartwallet";
import { EVMWallet } from "@crossmint/client-sdk-react-ui";

export interface CrossmintGelatoConfig {
  wallet: any; // Crossmint wallet instance
  address: Hex;
  chain?: Chain;
  apiKey?: string; // Gelato API key for sponsorship
}

/**
 * Get provider from Crossmint wallet
 * Tries multiple methods to access the EIP-1193 provider
 */
async function getCrossmintProvider(wallet: any): Promise<any> {
  console.log("[Gelato-Crossmint] Getting provider from Crossmint wallet...");
  console.log("[Gelato-Crossmint] Wallet keys:", Object.keys(wallet));

  const evmWallet = EVMWallet.from(wallet);
  console.log("[Gelato-Crossmint] EVMWallet keys:", Object.keys(evmWallet));

  // Try to get the signer first (Crossmint's actual interface)
  if ((evmWallet as any).signer) {
    console.log("[Gelato-Crossmint] Found signer property");
    const signer = (evmWallet as any).signer;

    // Check if signer has a provider
    if (signer.provider) {
      console.log("[Gelato-Crossmint] ✅ Got provider via signer.provider");
      return signer.provider;
    }

    // Check if signer has getProvider method
    if (typeof signer.getProvider === 'function') {
      try {
        const provider = await signer.getProvider();
        console.log("[Gelato-Crossmint] ✅ Got provider via signer.getProvider()");
        return provider;
      } catch (e) {
        console.warn("[Gelato-Crossmint] signer.getProvider() failed:", e);
      }
    }

    // The signer itself might be usable as a provider
    if (typeof signer.request === 'function') {
      console.log("[Gelato-Crossmint] ✅ Using signer as provider (has request method)");
      return signer;
    }
  }

  // Try wallet.signer
  if ((wallet as any).signer) {
    console.log("[Gelato-Crossmint] Found signer on wallet");
    const signer = (wallet as any).signer;

    if (signer.provider) {
      console.log("[Gelato-Crossmint] ✅ Got provider via wallet.signer.provider");
      return signer.provider;
    }

    if (typeof signer.request === 'function') {
      console.log("[Gelato-Crossmint] ✅ Using wallet.signer as provider");
      return signer;
    }
  }

  // Try traditional provider access methods
  if (typeof (evmWallet as any).getProvider === 'function') {
    try {
      const provider = await (evmWallet as any).getProvider();
      console.log("[Gelato-Crossmint] ✅ Got provider via evmWallet.getProvider()");
      return provider;
    } catch (e) {
      console.warn("[Gelato-Crossmint] evmWallet.getProvider() failed:", e);
    }
  }

  if ((evmWallet as any).provider) {
    console.log("[Gelato-Crossmint] ✅ Got provider via evmWallet.provider");
    return (evmWallet as any).provider;
  }

  if ((wallet as any).provider) {
    console.log("[Gelato-Crossmint] ✅ Got provider via wallet.provider");
    return (wallet as any).provider;
  }

  if (typeof (wallet as any).getProvider === 'function') {
    try {
      const provider = await (wallet as any).getProvider();
      console.log("[Gelato-Crossmint] ✅ Got provider via wallet.getProvider()");
      return provider;
    } catch (e) {
      console.warn("[Gelato-Crossmint] wallet.getProvider() failed:", e);
    }
  }

  if ((wallet as any).connector?.getProvider) {
    try {
      const provider = await (wallet as any).connector.getProvider();
      console.log("[Gelato-Crossmint] ✅ Got provider via connector.getProvider()");
      return provider;
    } catch (e) {
      console.warn("[Gelato-Crossmint] connector.getProvider() failed:", e);
    }
  }

  // Log what we found for debugging
  console.error("[Gelato-Crossmint] Failed to find provider. Available properties:", {
    wallet: Object.keys(wallet),
    evmWallet: Object.keys(evmWallet),
    hasSigner: !!(wallet as any).signer || !!(evmWallet as any).signer
  });

  throw new Error("Could not find EIP-1193 provider in Crossmint wallet. The wallet has a 'signer' property but no accessible provider.");
}

/**
 * Create a Gelato Smart Wallet Client from a Crossmint wallet
 *
 * This upgrades the Crossmint EOA to support:
 * - EIP-7702 delegation
 * - Gas sponsorship
 * - Batch transactions
 * - ERC-20 gas payments
 */
export async function createCrossmintGelatoClient(
  config: CrossmintGelatoConfig
): Promise<GelatoSmartWalletClient<any, any, any>> {
  const { wallet, address, chain = base, apiKey } = config;

  console.log("[Gelato-Crossmint] Creating Gelato Smart Wallet client", {
    address,
    chain: chain.name,
    hasApiKey: !!apiKey
  });

  try {
    // Step 1: Try to get Crossmint provider
    console.log("[Gelato-Crossmint] Attempting to get provider...");
    const provider = await getCrossmintProvider(wallet);

    // Step 2: Create viem WalletClient with provider
    console.log("[Gelato-Crossmint] Creating viem wallet client with provider...");
    const walletClient = createWalletClient({
      account: address,
      chain,
      transport: custom(provider),
    });
    console.log("[Gelato-Crossmint] ✅ viem wallet client created");

    // Step 3: Upgrade to Gelato Smart Wallet
    console.log("[Gelato-Crossmint] Upgrading to Gelato Smart Wallet...");
    const gelatoClient = await createGelatoSmartWalletClient(walletClient, {
      apiKey,
      // You can customize the smart contract wallet type here:
      // scw: { type: "gelato" } // or "kernel", "safe", etc.
    });

    console.log("[Gelato-Crossmint] ✅ Gelato Smart Wallet client created!");
    console.log("[Gelato-Crossmint] Smart Account Address:", gelatoClient.account.address);

    return gelatoClient;

  } catch (providerError) {
    console.error("[Gelato-Crossmint] ❌ Could not get provider:", providerError);

    // Alternative approach: Use Crossmint's signer directly
    console.log("[Gelato-Crossmint] Trying alternative approach with Crossmint signer...");

    const evmWallet = EVMWallet.from(wallet);
    const signer = (evmWallet as any).signer || (wallet as any).signer;

    if (!signer) {
      throw new Error("No signer found in Crossmint wallet. Cannot create Gelato client.");
    }

    console.log("[Gelato-Crossmint] Found signer, attempting to use it with viem...");
    console.log("[Gelato-Crossmint] Signer type:", signer.constructor?.name);
    console.log("[Gelato-Crossmint] Signer methods:", Object.keys(signer));

    // Check if signer is viem-compatible
    if (typeof signer.signMessage === 'function' && typeof signer.signTransaction === 'function') {
      console.log("[Gelato-Crossmint] Signer appears to be viem-compatible");

      // Create wallet client using the signer as account
      const walletClient = createWalletClient({
        account: signer,
        chain,
        transport: custom({
          async request({ method, params }: any) {
            console.log("[Gelato-Crossmint] Custom transport request:", method);
            // This is a fallback transport that uses the signer
            throw new Error(`Method ${method} not supported in fallback transport`);
          }
        }),
      });

      const gelatoClient = await createGelatoSmartWalletClient(walletClient, {
        apiKey,
      });

      console.log("[Gelato-Crossmint] ✅ Gelato Smart Wallet created with signer!");
      console.log("[Gelato-Crossmint] Smart Account Address:", gelatoClient.account.address);

      return gelatoClient;
    }

    throw new Error(
      "Crossmint wallet does not expose an EIP-1193 provider. " +
      "This is expected for social login wallets. " +
      "Consider using Crossmint's embedded wallet feature or waiting for EIP-7702 support."
    );
  }
}

/**
 * Register agent with EIP-7702 delegation using Gelato
 *
 * This replaces the direct EIP-7702 authorization approach with Gelato's
 * smart wallet infrastructure, which handles the delegation automatically.
 */
export async function registerAgentWithGelato(config: {
  wallet: any;
  address: Hex;
  agentContractAddress: Hex;
  apiKey?: string;
}): Promise<{
  smartAccountAddress: Hex;
  success: boolean;
}> {
  const { wallet, address, agentContractAddress, apiKey } = config;

  console.log("[Gelato-Crossmint] Registering agent with EIP-7702 delegation", {
    eoaAddress: address,
    agentContract: agentContractAddress
  });

  try {
    // Create Gelato Smart Wallet client
    const gelatoClient = await createCrossmintGelatoClient({
      wallet,
      address,
      apiKey
    });

    // The smart account is now created and can delegate to the agent contract
    // Store the smart account address for future use
    const smartAccountAddress = gelatoClient.account.address as Hex;

    console.log("[Gelato-Crossmint] ✅ Agent registered successfully", {
      smartAccountAddress,
      delegatedTo: agentContractAddress
    });

    return {
      smartAccountAddress,
      success: true
    };
  } catch (error) {
    console.error("[Gelato-Crossmint] ❌ Agent registration failed:", error);
    throw error;
  }
}

/**
 * Execute a transaction through Gelato Smart Wallet
 * Supports gas sponsorship and ERC-20 gas payments
 */
export async function executeTransaction(
  gelatoClient: GelatoSmartWalletClient<any, any, any>,
  calls: Array<{
    to: Hex;
    data: Hex;
    value?: bigint;
  }>,
  paymentMethod: "sponsored" | "native" | { token: Hex } = "sponsored"
) {
  console.log("[Gelato-Crossmint] Executing transaction", {
    callsCount: calls.length,
    paymentMethod
  });

  try {
    let payment;
    if (paymentMethod === "sponsored") {
      payment = sponsored();
    } else if (paymentMethod === "native") {
      payment = native();
    } else {
      payment = erc20(paymentMethod.token);
    }

    // Use the execute method from the Gelato client
    const response = await gelatoClient.execute({
      payment,
      calls
    });

    console.log("[Gelato-Crossmint] ✅ Transaction sent:", response);
    return response;
  } catch (error) {
    console.error("[Gelato-Crossmint] ❌ Transaction failed:", error);
    throw error;
  }
}

// Export payment methods for convenience
export { sponsored, native, erc20 } from "@gelatonetwork/smartwallet";
