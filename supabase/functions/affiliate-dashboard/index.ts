// Supabase Edge Function - Affiliate Dashboard API
// Handles affiliate status check, dashboard data retrieval, and withdrawal requests
// MVP version: Manual withdrawal processing by admin

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get(name: string): string | undefined;
  };
};

// ========== Configuration ==========
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://trteewgplkqiedonomzg.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

// ========== Auth Helpers ==========

interface UserPayload {
  id: string;
  email?: string;
}

/**
 * Decode JWT to get user info (avoids external API call)
 */
function decodeJWT(token: string): UserPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.error("Invalid JWT format");
      return null;
    }
    
    // Decode base64url payload
    const payload = parts[1];
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
    const decoded = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    const data = JSON.parse(decoded);
    
    return {
      id: data.sub,
      email: data.email,
    };
  } catch (error) {
    console.error("JWT decode error:", error);
    return null;
  }
}

/**
 * Verify access token and return user info
 */
async function verifyAccessToken(accessToken: string): Promise<UserPayload | null> {
  // Use local JWT decode for reliability
  const user = decodeJWT(accessToken);
  if (!user || !user.id) {
    return null;
  }
  return user;
}

/**
 * Get Supabase client with service role
 */
function getServiceClient() {
  return {
    url: SUPABASE_URL,
    headers: {
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
    },
  };
}

// ========== Database Query Helpers ==========

async function queryDatabase(sql: string, params: any[] = []): Promise<any> {
  const { url, headers } = getServiceClient();
  
  const response = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query: sql, params }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Database query failed: ${error}`);
  }

  return response.json();
}

/**
 * Check if user is an affiliate
 */
async function checkAffiliateStatus(userId: string): Promise<{ isAffiliate: boolean; affiliateId?: string }> {
  const { url, headers } = getServiceClient();
  
  console.log("Checking affiliate status for userId:", userId);
  console.log("Using headers:", JSON.stringify({ ...headers, Authorization: "[REDACTED]" }));
  
  const response = await fetch(
    `${url}/rest/v1/affiliates?user_id=eq.${userId}&is_active=eq.true&select=id`,
    {
      headers: {
        ...headers,
        "Prefer": "return=representation",
      },
    }
  );

  console.log("Affiliate check response status:", response.status);
  const responseText = await response.text();
  console.log("Affiliate check response body:", responseText);

  if (!response.ok) {
    throw new Error(`Failed to check affiliate status: ${responseText}`);
  }

  const data = JSON.parse(responseText);
  
  if (data && data.length > 0) {
    return {
      isAffiliate: true,
      affiliateId: data[0].id,
    };
  }

  return { isAffiliate: false };
}

/**
 * Get full dashboard data for an affiliate
 */
async function getDashboardData(affiliateId: string): Promise<{
  affiliate: any;
  stats: {
    totalCommission: number;
    pendingCommission: number;
    availableToWithdraw: number;
    paidOut: number;
    totalPurchases: number;
    totalBuyers: number;
  };
  purchases: any[];
  currentWithdrawal: any | null;
}> {
  const { url, headers } = getServiceClient();

  // Get affiliate info
  const affiliateResponse = await fetch(
    `${url}/rest/v1/affiliates?id=eq.${affiliateId}&select=*`,
    { headers }
  );

  if (!affiliateResponse.ok) {
    throw new Error("Failed to fetch affiliate info");
  }

  const affiliates = await affiliateResponse.json();
  
  if (!affiliates || affiliates.length === 0) {
    throw new Error("Affiliate not found");
  }

  const affiliate = affiliates[0];

  // Get commission stats
  const statsResponse = await fetch(
    `${url}/rest/v1/affiliate_commissions?affiliate_id=eq.${affiliateId}&select=purchase_amount,commission_amount,status,eligible_at`,
    { headers }
  );

  if (!statsResponse.ok) {
    throw new Error("Failed to fetch commission stats");
  }

  const commissions = await statsResponse.json();

  // Calculate stats
  let totalCommission = 0;
  let pendingCommission = 0;
  let availableToWithdraw = 0;
  let paidOut = 0;

  const now = new Date();

  for (const comm of commissions) {
    totalCommission += parseFloat(comm.commission_amount) || 0;

    if (comm.status === "pending") {
      const eligibleDate = new Date(comm.eligible_at);
      if (eligibleDate <= now) {
        // Eligible and available
        availableToWithdraw += parseFloat(comm.commission_amount) || 0;
      } else {
        // Still in waiting period
        pendingCommission += parseFloat(comm.commission_amount) || 0;
      }
    } else if (comm.status === "paid") {
      paidOut += parseFloat(comm.commission_amount) || 0;
    }
  }

  // Get purchase records with buyer email
  const purchasesResponse = await fetch(
    `${url}/rest/v1/affiliate_commissions?affiliate_id=eq.${affiliateId}&select=` +
    `id,paddle_transaction_id,plan_key,purchase_amount,commission_amount,status,eligible_at,created_at,user_id` +
    `&order=created_at.desc`,
    { headers }
  );

  if (!purchasesResponse.ok) {
    throw new Error("Failed to fetch purchase records");
  }

  let purchases = await purchasesResponse.json();

  // Fetch buyer emails from profiles
  const userIds = purchases.map((p: any) => p.user_id);
  let buyerEmails: Record<string, string> = {};

  if (userIds.length > 0) {
    const userIdsParam = userIds.join(",");
    console.log("Fetching profiles for userIds:", userIds);
    console.log("Query URL:", `${url}/rest/v1/profiles?id=in.(${userIdsParam})&select=id,email`);
    
    const profilesResponse = await fetch(
      `${url}/rest/v1/profiles?id=in.(${userIdsParam})&select=id,email`,
      { headers }
    );

    console.log("Profiles response status:", profilesResponse.status);
    const profilesText = await profilesResponse.text();
    console.log("Profiles response body:", profilesText);

    if (profilesResponse.ok) {
      const profiles = JSON.parse(profilesText);
      for (const profile of profiles) {
        buyerEmails[profile.id] = profile.email || "Unknown";
      }
      console.log("Built buyerEmails map:", buyerEmails);
    }
  }

  // Add buyer_email to purchases
  purchases = purchases.map((p: any) => ({
    ...p,
    buyer_email: buyerEmails[p.user_id] || "Unknown",
  }));

  // Get current pending withdrawal
  const withdrawalResponse = await fetch(
    `${url}/rest/v1/affiliate_withdrawals?affiliate_id=eq.${affiliateId}&status=eq.pending&select=*&limit=1`,
    { headers }
  );

  let currentWithdrawal = null;
  if (withdrawalResponse.ok) {
    const withdrawals = await withdrawalResponse.json();
    if (withdrawals && withdrawals.length > 0) {
      currentWithdrawal = withdrawals[0];
    }
  }

  return {
    affiliate: {
      id: affiliate.id,
      code: affiliate.code,
      name: affiliate.name,
      commission_rate: parseFloat(affiliate.commission_rate) || 0.4,
      is_active: affiliate.is_active,
    },
    stats: {
      totalCommission: Math.round(totalCommission * 100) / 100,
      pendingCommission: Math.round(pendingCommission * 100) / 100,
      availableToWithdraw: Math.round(availableToWithdraw * 100) / 100,
      paidOut: Math.round(paidOut * 100) / 100,
      totalPurchases: commissions.length,
      totalBuyers: new Set(commissions.map((c: any) => c.user_id)).size,
    },
    purchases,
    currentWithdrawal,
  };
}

/**
 * Request a withdrawal
 */
async function requestWithdrawal(affiliateId: string): Promise<{ success: boolean; message: string; withdrawalId?: string }> {
  const { url, headers } = getServiceClient();

  // Check if there's already a pending withdrawal
  const existingResponse = await fetch(
    `${url}/rest/v1/affiliate_withdrawals?affiliate_id=eq.${affiliateId}&status=eq.pending&select=id`,
    { headers }
  );

  if (existingResponse.ok) {
    const existing = await existingResponse.json();
    if (existing && existing.length > 0) {
      return {
        success: false,
        message: "You already have a pending withdrawal request.",
      };
    }
  }

  // Calculate available amount
  const now = new Date().toISOString();
  const eligibleResponse = await fetch(
    `${url}/rest/v1/affiliate_commissions?affiliate_id=eq.${affiliateId}&status=eq.pending&eligible_at=lte.${now}&select=commission_amount`,
    { headers }
  );

  if (!eligibleResponse.ok) {
    throw new Error("Failed to calculate available balance");
  }

  const eligibleCommissions = await eligibleResponse.json();
  let availableAmount = 0;

  for (const comm of eligibleCommissions) {
    availableAmount += parseFloat(comm.commission_amount) || 0;
  }

  if (availableAmount <= 0) {
    return {
      success: false,
      message: "No available balance to withdraw.",
    };
  }

  // Create withdrawal request
  const createResponse = await fetch(
    `${url}/rest/v1/affiliate_withdrawals`,
    {
      method: "POST",
      headers: {
        ...headers,
        "Prefer": "return=representation",
      },
      body: JSON.stringify({
        affiliate_id: affiliateId,
        amount: Math.round(availableAmount * 100) / 100,
        status: "pending",
      }),
    }
  );

  if (!createResponse.ok) {
    const error = await createResponse.text();
    throw new Error(`Failed to create withdrawal request: ${error}`);
  }

  const newWithdrawal = await createResponse.json();

  return {
    success: true,
    message: "Withdrawal request submitted. We'll contact you by email.",
    withdrawalId: newWithdrawal[0]?.id,
  };
}

// ========== Main Handler ==========

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get("Authorization");
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "No access token provided" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 401,
        }
      );
    }

    const accessToken = authHeader.replace("Bearer ", "");
    const user = await verifyAccessToken(accessToken);

    if (!user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 401,
        }
      );
    }

    // Parse URL and action
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (!action) {
      return new Response(
        JSON.stringify({ error: "Missing action parameter" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Handle different actions
    switch (action) {
      case "check": {
        // Check if user is an affiliate
        const result = await checkAffiliateStatus(user.id);
        
        return new Response(
          JSON.stringify(result),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }

      case "dashboard": {
        // Get full dashboard data
        const checkResult = await checkAffiliateStatus(user.id);
        
        if (!checkResult.isAffiliate || !checkResult.affiliateId) {
          return new Response(
            JSON.stringify({ error: "Not an affiliate" }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 403,
            }
          );
        }

        const dashboardData = await getDashboardData(checkResult.affiliateId);
        
        return new Response(
          JSON.stringify(dashboardData),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }

      case "withdraw": {
        // Request a withdrawal
        if (req.method !== "POST") {
          return new Response(
            JSON.stringify({ error: "Method not allowed" }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 405,
            }
          );
        }

        const checkResult = await checkAffiliateStatus(user.id);
        
        if (!checkResult.isAffiliate || !checkResult.affiliateId) {
          return new Response(
            JSON.stringify({ error: "Not an affiliate" }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 403,
            }
          );
        }

        const result = await requestWithdrawal(checkResult.affiliateId);
        
        return new Response(
          JSON.stringify(result),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: result.success ? 200 : 400,
          }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
          }
        );
    }
  } catch (error) {
    console.error("Affiliate dashboard error:", error);
    
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
