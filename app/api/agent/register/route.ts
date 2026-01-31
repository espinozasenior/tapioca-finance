
import { NextRequest, NextResponse } from "next/server";
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

/**
 * POST /api/agent/register
 * Registers the LiqX Agent as a delegated signer for the user's wallet (ERC-7702 flow)
 */
export async function POST(request: NextRequest) {
  try {
    const { address, authorization } = await request.json();

    if (!address) {
      return NextResponse.json({ error: "Missing wallet address" }, { status: 400 });
    }

    // 1. Store in Neon Database
    // We store the wallet address, enable auto-optimize, and save the 7702 authorization
    // We stringify the authorization object to ensure it's stored correctly as JSONB
    const authJson = JSON.stringify(authorization);

    await sql`
      INSERT INTO users (wallet_address, auto_optimize_enabled, agent_registered, authorization_7702)
      VALUES (${address}, true, true, ${authJson}::jsonb)
      ON CONFLICT (wallet_address) 
      DO UPDATE SET 
        auto_optimize_enabled = true, 
        agent_registered = true, 
        authorization_7702 = ${authJson}::jsonb,
        updated_at = NOW()
    `;

    // 2. Ensure user has a strategy entry
    // We use the newly created user's ID
    await sql`
      INSERT INTO user_strategies (user_id)
      SELECT id FROM users WHERE wallet_address = ${address}
      ON CONFLICT (user_id) DO NOTHING
    `;

    return NextResponse.json({
      message: "Agent registered and authorized successfully via ERC-7702",
      status: "active"
    });
  } catch (error: any) {
    console.error("Agent registration error:", error);
    return NextResponse.json({ error: error.message || "Failed to register agent" }, { status: 500 });
  }
}

/**
 * GET /api/agent/register
 * Checks if the agent is registered for a given address
 */
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");

  if (!address) {
    return NextResponse.json({ error: "Missing address" }, { status: 400 });
  }

  try {
    const users = await sql`
      SELECT auto_optimize_enabled, authorization_7702
      FROM users
      WHERE wallet_address = ${address}
    `;

    // Debug logging
    console.log("[Agent Status Check]", {
      address,
      userFound: users.length > 0,
      hasAuth: users.length > 0 && users[0].authorization_7702 !== null,
      authType: users.length > 0 ? typeof users[0].authorization_7702 : 'N/A',
      autoOptimize: users.length > 0 ? users[0].auto_optimize_enabled : 'N/A'
    });

    const hasAuthorization = users.length > 0 && users[0].authorization_7702 !== null;
    const autoOptimizeEnabled = users.length > 0 && users[0].auto_optimize_enabled;
    const isRegistered = hasAuthorization && autoOptimizeEnabled;

    return NextResponse.json({
      isRegistered,
      autoOptimizeEnabled,
      hasAuthorization,
      status: isRegistered ? "active" : "inactive"
    });
  } catch (error: any) {
    console.error("Agent status check error:", error);
    return NextResponse.json(
      {
        isRegistered: false,
        autoOptimizeEnabled: false,
        hasAuthorization: false,
        status: "error",
        error: process.env.NODE_ENV === "development" ? error.message : "Database error"
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/agent/register
 * Updates the auto-optimize setting for a registered agent
 */
export async function PATCH(request: NextRequest) {
  try {
    const { address, autoOptimizeEnabled } = await request.json();

    if (!address) {
      return NextResponse.json({ error: "Missing wallet address" }, { status: 400 });
    }

    if (typeof autoOptimizeEnabled !== 'boolean') {
      return NextResponse.json({ error: "autoOptimizeEnabled must be a boolean" }, { status: 400 });
    }

    // Check if user exists and has authorization
    const users = await sql`
      SELECT authorization_7702
      FROM users
      WHERE wallet_address = ${address}
    `;

    if (users.length === 0 || !users[0].authorization_7702) {
      return NextResponse.json({ error: "Agent not registered. Please register first." }, { status: 400 });
    }

    // Update the auto_optimize_enabled flag
    await sql`
      UPDATE users
      SET auto_optimize_enabled = ${autoOptimizeEnabled},
          updated_at = NOW()
      WHERE wallet_address = ${address}
    `;

    return NextResponse.json({
      message: "Auto-optimize setting updated successfully",
      autoOptimizeEnabled,
      status: autoOptimizeEnabled ? "active" : "inactive"
    });
  } catch (error: any) {
    console.error("Auto-optimize update error:", error);
    return NextResponse.json({ error: error.message || "Failed to update auto-optimize setting" }, { status: 500 });
  }
}
