
import { optimize, getAllOpportunities, getCurrentPosition } from "../lib/yield-optimizer";
import { agentSend7702Batch, simulateTransaction } from "../lib/crossmint";
import { buildRebalanceTransactions } from "../lib/yield-optimizer/executor";
import { neon } from '@neondatabase/serverless';

// Initialize Neon client
const sql = neon(process.env.DATABASE_URL!);

/**
 * LiqX Autonomous Agent Monitoring Loop (ERC-7702 + Neon)
 */
async function monitorAndOptimize() {
  console.log(`[${new Date().toISOString()}] LiqX Agent: Starting monitoring cycle...`);

  try {
    // 1. Fetch active users and their strategies from Neon
    const activeUsers = await sql`
      SELECT u.id, u.wallet_address, u.authorization_7702, 
             s.min_apy_gain_threshold, s.max_slippage_tolerance 
      FROM users u
      JOIN user_strategies s ON u.id = s.user_id
      WHERE u.auto_optimize_enabled = true AND u.authorization_7702 IS NOT NULL
    `;

    console.log(`Found ${activeUsers.length} active users with ERC-7702 authorizations.`);

    for (const user of activeUsers) {
      const address = user.wallet_address as `0x${string}`;
      const auth7702 = user.authorization_7702;
      
      try {
        console.log(`Checking strategies for user: ${address}`);
        
        // 2. Evaluate current position vs opportunities
        const decision = await optimize(address, 0n);

        if (decision.shouldRebalance && decision.from && decision.to) {
          const apyGain = decision.netGain;
          const threshold = Number(user.min_apy_gain_threshold);
          
          if (apyGain < threshold) {
            console.log(`Rebalance ignored: Gain (${(apyGain * 100).toFixed(2)}%) below user threshold (${(threshold * 100).toFixed(2)}%).`);
            continue;
          }

          console.log(`Rebalance recommended: ${decision.reason}`);
          
          // 3. Execution (The "Hand" - ERC-7702 Batch)
          console.log(`Building rebalance batch: ${decision.from.protocol} -> ${decision.to.name}`);
          
          const amountUsdc = (Number(decision.from.assets) / 1e6).toFixed(6);
          
          const rebalanceRes = await buildRebalanceTransactions(
            decision.from.protocol,
            decision.to.protocol,
            address,
            amountUsdc,
            decision.from.vaultAddress,
            decision.to.metadata?.vaultAddress
          );

          // Prepare calls for the batch
          const sortedTxs = [...rebalanceRes.transactions].sort((a, b) => a.stepIndex - b.stepIndex);
          const calls = sortedTxs.map(tx => {
            const unsigned = JSON.parse(tx.unsignedTransaction);
            return {
              to: unsigned.to,
              data: unsigned.data,
              value: unsigned.value || "0"
            };
          });

          // 4. Simulation
          console.log(`Simulating batch of ${calls.length} calls...`);
          let allSimulated = true;
          for (const call of calls) {
            const sim = await simulateTransaction(address, call);
            if (!sim.success) {
              console.error(`❌ Simulation failed for call: ${JSON.stringify(call)}. Error: ${sim.error}`);
              allSimulated = false;
              break;
            }
          }

          if (!allSimulated) {
            console.log("Aborting batch execution due to simulation failure.");
            continue;
          }

          // 5. Submit ERC-7702 Transaction via Crossmint
          console.log("✅ Simulation passed. Sending ERC-7702 batch via Crossmint...");
          
          try {
            const result = await agentSend7702Batch(
              address,
              [auth7702], // The stored EIP-7702 authorization
              calls
            );

            console.log(`✅ Autonomous rebalance completed for ${address}. Tx ID: ${result.id || "OK"}`);
            
            // Log success to Neon
            await sql`
              INSERT INTO agent_actions (user_id, action_type, status, from_protocol, to_protocol, amount_usdc, tx_hash)
              VALUES (${user.id}, 'rebalance', 'success', ${decision.from.protocol}, ${decision.to.protocol}, ${Number(amountUsdc)}, ${result.id || null})
            `;
          } catch (execError: any) {
            console.error(`❌ Execution failed for ${address}:`, execError);
            await sql`
              INSERT INTO agent_actions (user_id, action_type, status, error_message)
              VALUES (${user.id}, 'rebalance', 'failed', ${execError.message})
            `;
          }
        } else {
          console.log(`User ${address} strategy is currently optimal.`);
        }

      } catch (error) {
        console.error(`Error processing user ${address}:`, error);
      }
    }
  } catch (dbError) {
    console.error("Database error during monitoring cycle:", dbError);
  }

  console.log("LiqX Agent: Monitoring cycle completed.");
}

// Run every minute (for simulation)
setInterval(monitorAndOptimize, 60000);
monitorAndOptimize();
