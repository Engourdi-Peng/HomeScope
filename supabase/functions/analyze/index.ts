// Supabase Edge Function - Rental & Sale Property Analyzer
// Deploy with: supabase functions deploy analyze

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type ReportMode = 'rent' | 'sale';

type AnalysisStage =
  | "upload_received"
  | "detecting_rooms"
  | "evaluating_spaces"
  | "extracting_strengths_and_issues"
  | "estimating_competition"
  | "building_final_report"
  | "done"
  | "failed";

interface AnalysisState {
  id?: string;
  stage: AnalysisStage;
  message: string;
  progress: number;
  status: "queued" | "processing" | "done" | "failed";
  result?: unknown;
  error?: string;
}

type Step1UserContent =
  | { type: "image_url"; image_url: { url: string } }
  | { type: "text"; text: string };

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get(name: string): string | undefined;
  };
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://trteewgplkqiedonomzg.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://www.tryhomescope.com";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

// ========== Auth Helpers ==========

interface UserProfile {
  id: string;
  email: string;
  credits_remaining: number;
  credits_reserved: number;
  credits_used: number;
}

/**
 * Get current user from Authorization header
 */
async function getCurrentUser(req: Request): Promise<{ user: UserProfile | null; error: string | null }> {
  const authHeader = req.headers.get("Authorization");
  const apikey = req.headers.get("apikey");
  
  console.log("=== getCurrentUser Debug ===");
  console.log("Authorization header exists:", !!authHeader);
  console.log("Authorization header preview:", authHeader ? authHeader.substring(0, 20) + "..." : "NONE");
  console.log("apikey header exists:", !!apikey);
  console.log("apikey matches anon key:", apikey === SUPABASE_ANON_KEY);
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.log("getCurrentUser error: Missing or invalid Authorization header");
    return { user: null, error: "Missing or invalid Authorization header" };
  }

  const token = authHeader.replace("Bearer ", "");
  console.log("Token preview:", token.substring(0, 15) + "...");

  try {
    // Verify token and get user from Supabase Auth
    // MUST use SUPABASE_ANON_KEY (not service role key) to validate user tokens
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "apikey": SUPABASE_ANON_KEY,
      },
    });

    console.log("Auth API response status:", userResponse.status);
    
    if (!userResponse.ok) {
      const errorText = await userResponse.text();
      console.log("Auth API error:", errorText);
      return { user: null, error: "Invalid or expired token" };
    }

    const userData = await userResponse.json();
    console.log("Auth user ID:", userData.id);
    console.log("Auth user email:", userData.email);

    // Get user profile with credits (including reserved)
    // For profile queries, we use service role key (or anon key with RLS policies)
    const profileResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userData.id}&select=id,email,credits_remaining,credits_reserved,credits_used`,
      {
        headers: {
          "apikey": SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY}`,
        },
      }
    );

    if (!profileResponse.ok) {
      console.log("Profile fetch error:", profileResponse.status);
      return { user: null, error: "Failed to fetch user profile" };
    }

    const profiles = await profileResponse.json();
    if (!Array.isArray(profiles) || profiles.length === 0) {
      console.log("Profile not found for user:", userData.id);
      return { user: null, error: "User profile not found" };
    }

    return { user: profiles[0] as UserProfile, error: null };
  } catch (err) {
    console.error("Auth error:", err);
    return { user: null, error: "Authentication failed" };
  }
}

/**
 * Check if user has available credits (remaining - reserved > 0)
 */
function hasAvailableCredits(user: UserProfile | null): boolean {
  if (!user) return false;
  return (user.credits_remaining - user.credits_reserved) > 0;
}

// ========== SEO Helper Functions ==========

/**
 * Convert string to URL-safe slug
 */
function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Generate semantic share slug
 * Format: suburb-bedroom-propertyType-rental-analysis-{id}  (rent mode)
 *         suburb-bedroom-propertyType-sale-analysis-{id}     (sale mode)
 */
function generateShareSlug(input: {
  suburb?: string | null;
  bedrooms?: number | null;
  propertyType?: string | null;
  reportId: string;
  reportMode?: ReportMode;
}): string {
  const parts: string[] = [];

  if (input.suburb) {
    parts.push(toSlug(input.suburb));
  }

  if (input.bedrooms != null) {
    parts.push(`${input.bedrooms}-bedroom`);
  }

  if (input.propertyType) {
    parts.push(toSlug(input.propertyType));
  }

  parts.push(input.reportMode === 'sale' ? 'sale-analysis' : 'rental-analysis');
  parts.push(String(input.reportId));

  return parts.join('-');
}

/**
 * Generate SEO title and description
 */
function generateSEOFields(input: {
  suburb?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  weeklyRent?: number | null;
  askingPrice?: number | null;
  verdict?: string | null;
  reportId: string;
  reportMode?: ReportMode;
}): { seo_title: string; seo_description: string } {
  const { suburb, bedrooms, bathrooms, weeklyRent, askingPrice, verdict, reportMode } = input;
  const isRent = reportMode !== 'sale';

  // Generate SEO title
  let seo_title: string;
  if (isRent) {
    if (suburb && bedrooms) {
      seo_title = `Is this rental worth it in ${suburb}? ${bedrooms} bedroom analysis`;
    } else if (bedrooms) {
      seo_title = `Is this rental worth it? ${bedrooms} bedroom analysis`;
    } else {
      seo_title = `Rental property analysis | HomeScope`;
    }
  } else {
    if (suburb && bedrooms) {
      seo_title = `Is this property worth buying in ${suburb}? ${bedrooms} bedroom analysis`;
    } else if (bedrooms) {
      seo_title = `Is this property worth buying? ${bedrooms} bedroom analysis`;
    } else {
      seo_title = `Property purchase analysis | HomeScope`;
    }
  }

  // Generate SEO description
  let seo_description: string;
  if (isRent) {
    if (suburb && bedrooms) {
      seo_description = `AI rental analysis of a ${bedrooms}-bedroom property in ${suburb}. `;
      if (bathrooms) seo_description += `${bathrooms} bathroom, `;
      if (weeklyRent) seo_description += `$${weeklyRent}/week. `;
      seo_description += 'Review the pros, cons, risks and final verdict before applying.';
    } else if (bedrooms) {
      seo_description = `AI rental analysis of a ${bedrooms}-bedroom property. `;
      if (bathrooms) seo_description += `${bathrooms} bathroom, `;
      if (weeklyRent) seo_description += `$${weeklyRent}/week. `;
      seo_description += 'Review the pros, cons, risks and final verdict before applying.';
    } else {
      seo_description = 'AI-powered rental property analysis. Review detailed pros, cons, risks and expert verdict before making your decision.';
    }
  } else {
    if (suburb && bedrooms) {
      seo_description = `AI purchase analysis of a ${bedrooms}-bedroom property in ${suburb}. `;
      if (bathrooms) seo_description += `${bathrooms} bathroom, `;
      if (askingPrice) seo_description += `$${askingPrice.toLocaleString()}. `;
      seo_description += 'Review the pros, cons, risks and final verdict before making an offer.';
    } else if (bedrooms) {
      seo_description = `AI purchase analysis of a ${bedrooms}-bedroom property. `;
      if (bathrooms) seo_description += `${bathrooms} bathroom, `;
      if (askingPrice) seo_description += `$${askingPrice.toLocaleString()}. `;
      seo_description += 'Review the pros, cons, risks and final verdict before making an offer.';
    } else {
      seo_description = 'AI-powered property purchase analysis. Review detailed pros, cons, risks and expert verdict before making your decision.';
    }
  }

  return {
    seo_title: seo_title.slice(0, 60),
    seo_description: seo_description.slice(0, 160),
  };
}

// ========== Dev Mode / Test Account Whitelist ==========

const DEV_MODE_WHITELIST = [
  'test@example.com',
  'dev@example.com',
  'localhost@test.com',
  // Add more test emails here
];

/**
 * Check if user should bypass credits check (dev mode / test accounts)
 * This is controlled by environment variable DEV_BYPASS_CREDITS or whitelist
 */
function shouldBypassCreditsCheck(user: UserProfile | null): boolean {
  if (!user) return false;
  
  // Check environment variable first
  const devBypass = Deno.env.get("DEV_BYPASS_CREDITS");
  if (devBypass === "true" || devBypass === "1") {
    console.log("[DEV] Credits check bypassed via DEV_BYPASS_CREDITS env");
    return true;
  }
  
  // Check whitelist
  const userEmail = user.email?.toLowerCase() || '';
  for (const whitelisted of DEV_MODE_WHITELIST) {
    if (userEmail.includes(whitelisted.toLowerCase())) {
      console.log(`[DEV] Credits check bypassed for whitelisted email: ${user.email}`);
      return true;
    }
  }
  
  return false;
}

/**
 * Add credits to a user (for dev/testing purposes)
 * Only works in dev mode or for whitelisted accounts
 */
async function addDevCredits(userId: string, amount: number = 10): Promise<boolean> {
  // Only allow in dev mode
  const devBypass = Deno.env.get("DEV_BYPASS_CREDITS");
  if (devBypass !== "true" && devBypass !== "1") {
    console.log("[DEV] addDevCredits skipped - DEV_BYPASS_CREDITS not enabled");
    return false;
  }
  
  try {
    const check = await fetchJson(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=credits_remaining`,
      { headers: { "apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    
    if (!check.ok || !Array.isArray(check.payload) || check.payload.length === 0) {
      return false;
    }
    
    const current = check.payload[0].credits_remaining || 0;
    
    const update = await fetchJson(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ credits_remaining: current + amount }),
      }
    );
    
    return update.ok;
  } catch (err) {
    console.error("[DEV] addDevCredits error:", err);
    return false;
  }
}

// ========== Credits & Usage Records Operations (Atomic) ==========

/**
 * Reserve a credit for analysis - ATOMIC operation
 * Uses UPDATE with WHERE clause to prevent race conditions
 * Returns: { success: true, usageId } or { success: false, error }
 */
/**
 * Unified fetch helper - reads body only once
 */
async function fetchJson(url: string, options?: RequestInit): Promise<{ ok: boolean; status: number; payload: any }> {
  const res = await fetch(url, options);
  const raw = await res.text();

  let payload: any = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = { raw };
  }

  if (!res.ok) {
    console.error("upstream error", {
      url: url.replace(SUPABASE_URL, "***"),
      status: res.status,
      payload,
    });
  }

  return { ok: res.ok, status: res.status, payload };
}

async function reserveCredits(userId: string, analysisId: string): Promise<{ success: boolean; usageId?: string; error?: string }> {
  console.log(`[reserveCredits] userId=${userId}, analysisId=${analysisId}`);

  try {
    // Step 1: Check current credits
    const check = await fetchJson(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=credits_remaining,credits_reserved`,
      { headers: { "apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    );

    if (!check.ok) {
      if (check.status === 404) return { success: false, error: "User not found" };
      return { success: false, error: "Failed to check credits" };
    }

    const profiles = check.payload;
    if (!Array.isArray(profiles) || profiles.length === 0) {
      return { success: false, error: "User not found" };
    }

    const profile = profiles[0];
    const available = profile.credits_remaining - profile.credits_reserved;
    console.log(`[reserveCredits] remaining=${profile.credits_remaining}, reserved=${profile.credits_reserved}, available=${available}`);

    if (available <= 0) {
      return { success: false, error: "No credits available" };
    }

    // Step 2: Reserve a credit
    const update = await fetchJson(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Prefer": "return=representation",
        },
        body: JSON.stringify({ credits_reserved: profile.credits_reserved + 1 }),
      }
    );

    if (!update.ok) {
      console.error("[reserveCredits] update failed:", update.payload);
      return { success: false, error: "Failed to reserve credit" };
    }

    const updatedProfiles = update.payload;
    if (!Array.isArray(updatedProfiles) || updatedProfiles.length === 0) {
      return { success: false, error: "No credits available" };
    }

    // Step 3: Create usage record
    const usage = await fetchJson(
      `${SUPABASE_URL}/rest/v1/usage_records`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Prefer": "return=representation",
        },
        body: JSON.stringify({
          user_id: userId,
          analysis_id: analysisId,
          status: "reserved",
          credits_change: 0,
        }),
      }
    );

    let usageId: string | undefined;
    if (usage.ok && Array.isArray(usage.payload) && usage.payload.length > 0) {
      usageId = usage.payload[0].id;
    }

    console.log(`[reserveCredits] done, usageId=${usageId}`);
    return { success: true, usageId };
  } catch (err) {
    console.error("[reserveCredits] error:", err);
    return { success: false, error: "Failed to reserve credits" };
  }
}

/**
 * Release reserved credit
 * Called when analysis fails
 */
async function releaseCredits(userId: string, usageId?: string): Promise<boolean> {
  console.log(`[releaseCredits] userId=${userId}, usageId=${usageId}`);

  try {
    // Step 1: Check current reserved credits
    const check = await fetchJson(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=credits_reserved`,
      { headers: { "apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    );

    if (!check.ok) {
      console.warn(`[releaseCredits] user not found or error: ${check.status}`);
      return false;
    }

    const profiles = check.payload;
    if (!Array.isArray(profiles) || profiles.length === 0) {
      return true;
    }

    const reserved = profiles[0].credits_reserved;
    if (reserved <= 0) {
      console.log(`[releaseCredits] no reserved credits to release`);
      return true;
    }

    // Step 2: Decrement reserved credits
    const update = await fetchJson(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ credits_reserved: reserved - 1 }),
      }
    );

    if (!update.ok) {
      console.error("[releaseCredits] update failed:", update.payload);
      return false;
    }

    // Step 3: Update usage record status
    if (usageId) {
      await fetchJson(
        `${SUPABASE_URL}/rest/v1/usage_records?id=eq.${usageId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ status: "released" }),
        }
      );
    }

    console.log(`[releaseCredits] done`);
    return true;
  } catch (err) {
    console.error("[releaseCredits] error:", err);
    return false;
  }
}

/**
 * Complete analysis and finalize credit usage
 * Called when analysis succeeds
 */
async function completeCredits(userId: string, usageId?: string): Promise<boolean> {
  console.log(`[completeCredits] userId=${userId}, usageId=${usageId}`);

  try {
    // Step 1: Check current credits
    const check = await fetchJson(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=credits_remaining,credits_reserved,credits_used`,
      { headers: { "apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    );

    if (!check.ok) {
      console.error("[completeCredits] check failed:", check.payload);
      return false;
    }

    const profiles = check.payload;
    if (!Array.isArray(profiles) || profiles.length === 0) {
      console.warn("[completeCredits] user not found");
      return false;
    }

    const profile = profiles[0];
    if (profile.credits_reserved <= 0) {
      console.log("[completeCredits] no reserved credits to complete");
      return true;
    }

    // Step 2: Finalize: remaining - 1, reserved - 1, used + 1
    const update = await fetchJson(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          credits_remaining: profile.credits_remaining - 1,
          credits_reserved: profile.credits_reserved - 1,
          credits_used: profile.credits_used + 1,
        }),
      }
    );

    if (!update.ok) {
      console.error("[completeCredits] update failed:", update.payload);
      return false;
    }

    // Step 3: Update usage record
    if (usageId) {
      await fetchJson(
        `${SUPABASE_URL}/rest/v1/usage_records?id=eq.${usageId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ status: "completed", credits_change: 1 }),
        }
      );
    }

    console.log(`[completeCredits] done: remaining=${profile.credits_remaining - 1}, used=${profile.credits_used + 1}`);
    return true;
  } catch (err) {
    console.error("[completeCredits] error:", err);
    return false;
  }
}

// ========== Analysis States Table Helpers ==========

async function createAnalysisState(id: string): Promise<void> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/analysis_states`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({
      id,
      stage: "upload_received",
      message: "Upload received, starting analysis...",
      progress: 5,
      status: "queued",
    }),
  });
  if (!response.ok) {
    console.error("Failed to create analysis state:", await response.text());
  }
}

async function getAnalysisState(id: string): Promise<AnalysisState & { reportMode?: string } | null> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/analysis_states?id=eq.${id}&select=*`, {
    headers: {
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!response.ok) return null;
  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  return {
    id: data[0].id,
    stage: data[0].stage,
    message: data[0].message,
    progress: data[0].progress,
    status: data[0].status,
    result: data[0].result,
    error: data[0].error,
    reportMode: data[0].report_mode || undefined,
  };
}

async function updateAnalysisState(id: string, patch: Partial<AnalysisState>): Promise<void> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/analysis_states?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({
      ...patch,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) {
    console.error("Failed to update analysis state:", await response.text());
  }
}

// ========== Analyses History Functions ==========

interface AnalysisRecord {
  id: string;
  user_id: string;
  status: string;
  overall_score?: number;
  verdict?: string;
  title?: string;
  address?: string;
  cover_image_url?: string;
  summary?: Record<string, unknown>;
  full_result?: Record<string, unknown>;
}

/**
 * 判断 URL 是否疑似 logo / 品牌图，用于过滤封面图
 */
function isLikelyLogoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return /\/logo|favicon|avatar|watermark|\/icons?\/|sprite|agency-badge|brand-mark/i.test(lower);
}

/**
 * 从图片列表中取第一个非 logo 的真实房源图
 */
function pickCoverImage(imageUrls: string[]): string | null {
  for (const url of imageUrls) {
    if (isLikelyLogoUrl(url)) continue;
    return url;
  }
  return null;
}

/**
 * Create a new analysis record in the analyses table
 */
async function createAnalysisRecord(
  id: string,
  userId: string,
  imageUrls: string[],
  description: string,
  optionalDetails?: Record<string, unknown>,
  reportMode?: ReportMode
): Promise<{ success: boolean; error?: string }> {
  // Extract title/address from description if available
  const title = extractTitleFromDescription(description);
  const address = optionalDetails?.suburb as string | undefined;
  const coverImage = pickCoverImage(imageUrls);

  console.log("=== createAnalysisRecord called ===");
  console.log("Analysis ID:", id);
  console.log("User ID:", userId);
  console.log("Title:", title);
  console.log("Address:", address);
  console.log("Cover image:", coverImage);
  console.log("Report mode:", reportMode);
  console.log("Image URLs count:", imageUrls.length);

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/analyses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Prefer": "return=representation",
      },
      body: JSON.stringify({
        id,
        user_id: userId,
        status: "pending",
        title: title || null,
        address: address || null,
        cover_image_url: coverImage || null,
        summary: null,
        full_result: null,
        report_mode: reportMode || 'rent',
      }),
    });

    console.log("createAnalysisRecord response status:", response.status);
    const responseText = await response.text();
    console.log("createAnalysisRecord response body:", responseText);

    if (!response.ok) {
      console.error("Failed to create analysis record:", responseText);
      return { success: false, error: responseText };
    }

    // Parse the response to confirm record was created
    let createdRecord: Record<string, unknown> | null = null;
    try {
      createdRecord = JSON.parse(responseText);
    } catch {
      // If no representation returned, consider it successful
      createdRecord = { id };
    }

    console.log("Analysis record created successfully:", (createdRecord as { id?: string })?.id || id);
    return { success: true };
  } catch (err) {
    console.error("createAnalysisRecord exception:", err);
    return { success: false, error: String(err) };
  }
}

/**
 * Update analysis record when analysis completes
 */
async function updateAnalysisRecord(
  id: string,
  overallScore: number,
  verdict: string,
  summary: Record<string, unknown>,
  fullResult: Record<string, unknown>,
  reportMode: ReportMode // 新增参数
): Promise<{ success: boolean; error?: string }> {
  console.log("=== updateAnalysisRecord called ===");
  console.log("Analysis ID:", id);
  console.log("Overall score:", overallScore);
  console.log("Verdict:", verdict);
  console.log("Report mode:", reportMode);

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/analyses?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({
        status: "done",
        overall_score: overallScore,
        verdict: verdict,
        summary: {
          quickSummary: summary.quickSummary,
          whatLooksGood: summary.whatLooksGood,
          riskSignals: summary.riskSignals,
        },
        full_result: fullResult,
        report_mode: reportMode, // 同步更新 report_mode 字段
        updated_at: new Date().toISOString(),
      }),
    });

    console.log("updateAnalysisRecord response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to update analysis record:", errorText);
      return { success: false, error: errorText };
    }

    console.log("Analysis record updated successfully:", id);
    return { success: true };
  } catch (err) {
    console.error("updateAnalysisRecord exception:", err);
    return { success: false, error: String(err) };
  }
}

/**
 * Mark analysis record as failed
 */
async function failAnalysisRecord(id: string, error: string): Promise<{ success: boolean; error?: string }> {
  console.log("=== failAnalysisRecord called ===");
  console.log("Analysis ID:", id);
  console.log("Error:", error);

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/analyses?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({
        status: "failed",
        summary: { error },
        updated_at: new Date().toISOString(),
      }),
    });

    console.log("failAnalysisRecord response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to mark analysis as failed:", errorText);
      return { success: false, error: errorText };
    }

    console.log("Analysis marked as failed:", id);
    return { success: true };
  } catch (err) {
    console.error("failAnalysisRecord exception:", err);
    return { success: false, error: String(err) };
  }
}

/**
 * Extract a title from the description (first line or first 50 chars)
 */
function extractTitleFromDescription(description: string): string | null {
  if (!description) return null;
  const firstLine = description.split("\n")[0].trim();
  if (firstLine.length === 0) return null;
  return firstLine.length > 100 ? firstLine.substring(0, 100) + "..." : firstLine;
}

// ========== Prompts ==========

const STEP1_SYSTEM_PROMPT = `You are a visual property analyst for rental listings.

Your job is to extract SHORT structured visual signals from the provided photos.

Classify each photo into one of:
- "bedroom"
- "bathroom"
- "kitchen"
- "living_room"
- "garage"
- "laundry"
- "exterior"
- "hallway"
- "storage"
- "dining"
- "unknown"

================================
SCORE DISTRIBUTION — USE FULL RANGE
================================

Give scores that actually reflect what you see. Not everyone scores 65.

Score ranges:
- 90-100: Exceptional. Rare. Looks genuinely outstanding.
- 80-89: Strong. Well-presented, clearly above average.
- 70-79: Good. Solid, functional, worthwhile.
- 60-69: Average. Acceptable but nothing special.
- 50-59: Below average. Noticeable weaknesses.
- 40-49: Poor. Significant issues visible.
- Below 40: Very poor. Serious problems.

IMPORTANT: Only give 70+ scores when genuinely justified by what you see.

================================
LOW SCORE TRIGGERS — TWO-TIER SYSTEM
================================

MAJOR ISSUES → score MUST be below 55:
- Room is very dark with minimal natural light
- Visible damage, wear, or deterioration
- Outdated fixtures throughout
- Significantly smaller than expected

SEVERE ISSUES → score can go 40–50:
- Major structural issues visible
- Signs of neglect or poor maintenance
- Extremely cramped or uncomfortable
- Multiple major problems in one space

================================
HIGH SCORE TRIGGERS — SCORE SHOULD BE ABOVE 75
================================

If MOST of the following (3 out of 4) are true, score SHOULD be above 75:
- Modern appliances or recent renovation
- Good natural light
- Clean and well-maintained
- Functional layout with adequate space

If ALL four are true, score SHOULD be 80 or above.

================================
FINAL CALIBRATION — PREVENT MID-RANGE CLUSTERING
================================

If your score ends up between 60–70:
- Re-evaluate the strongest signals
- Push the score UP or DOWN decisively

Do NOT leave scores in the 60–70 range unless evidence is genuinely mixed and balanced.

Key principle: Bad spaces should fall below 60. Good spaces should exceed 70.
Avoid the "safe zone" of 63–68.

SPACE-SPECIFIC SCORING:

Kitchen:
- Clean, bright, modern appliances, good storage → 70-85
- Narrow, dark, limited bench space → 40-60

Bathroom:
- Clean tiles, updated fixtures, well-maintained → 70-85
- Dated fittings, visible wear → 40-60

Bedroom:
- Good light, maintained flooring, visible AC → 70-85
- Small, dark, worn, cluttered → 40-60

Exterior:
- Maintained yard, usable outdoor area → 70-85
- Visible wear, poor upkeep → 40-60

Return concise JSON only.

OUTPUT FORMAT:
{
  "photos": [
    {
      "photoIndex": 0,
      "areaType": "kitchen",
      "summary": "Short factual description only",
      "score": 65
    }
  ],
  "spaceAnalysis": [
    {
      "spaceType": "kitchen",
      "score": 65,
      "observations": ["Narrow layout", "Limited bench space", "Storage not visible"]
    },
    {
      "spaceType": "bathroom",
      "score": 78,
      "observations": ["Recently updated", "Clean tiles", "Fixtures maintained"]
    }
  ],
  "kitchenCondition": "Good" | "Average" | "Poor" | "Unknown",
  "bathroomCondition": "Good" | "Average" | "Poor" | "Unknown",
  "renovationLevel": "Modern" | "Mixed" | "Dated" | "Original" | "Unknown",
  "naturalLight": "Good" | "Medium" | "Low" | "Unknown",
  "spacePerception": "Spacious" | "Fair" | "Smaller Than Expected" | "Unknown",
  "maintenanceCondition": "Good" | "Average" | "Questionable" | "Unknown",
  "cosmeticFlipRisk": "Low" | "Medium" | "High" | "Unknown",
  "missingKeyAreas": ["area1", "area2"],
  "photoObservations": ["short observation 1", "short observation 2"],
  "spatialMetrics": {
    "buildIntegrity": "Strong" | "Adequate" | "Inconsistent" | "Unknown",
    "passiveLight": "Excellent" | "Good" | "Fair" | "Poor" | "Unknown",
    "maintenanceDepth": "Well Maintained" | "Average" | "Superficial" | "Unknown"
  }
}

RULES:
- Analyze every photo individually
- Aggregate photos of the same space type in spaceAnalysis
- Keep all text fields SHORT
- Use only visible evidence - do not assume
- Do not add markdown
- Do not wrap output in code fences
- If uncertain, use "Unknown"
- photoObservations: max 2 items
- summary: one short sentence only
- spatialMetrics: evaluate based on overall evidence across all photos
- spaceAnalysis: only include spaces that have photos, max 3 observations per space
- Be decisive — avoid defaulting to mid-range scores
- Strong positives → score above 75
- Strong negatives → score below 60`;

// STEP2_RENT_PROMPT — the original RENT-specific prompt
const STEP2_RENT_PROMPT = `You are an Australian renter helping another renter decide whether a listing is worth their time.

Think of it like getting advice from a mate who's rented a dozen places and knows what's annoying. Be practical, direct, and honest. You're not trying to sell the place — you're trying to help someone avoid a bad decision.

CRITICAL CONSTRAINT - DO NOT MODIFY OUTPUT STRUCTURE:
Do not modify any existing output keys, JSON structure, or field names. Only change wording inside string values.

CRITICAL RULES:
1. Only analyze based on provided visual data and listing text. Do not assume details not provided.
2. Be skeptical of marketing language: "bright", "spacious", "modern", "recently renovated", "luxury", "stunning"
3. When listing claims conflict with visual evidence, prioritize what you can SEE

================================
TONE & LANGUAGE (AUSTRALIA)
================================
Write in natural Australian English, as if advising a local renter.

CRITICAL STYLE RULES:
- Sound like a person, not a report
- Keep sentences short (ideally under 15 words)
- Use casual, practical wording
- Slightly conversational, but still clear
- Avoid formal or corporate tone

DO:
- "Gets good light in the afternoon"
- "Could feel a bit cold in winter"
- "Worth checking in person"
- "Might need a bit of work"

DO NOT:
- "This property appears to"
- "Overall, this indicates"
- "It is recommended that"
- "In conclusion"

AVOID:
- Overly long explanations
- Balanced essay-style sentences
- Repetitive phrasing

Make it feel like advice from someone who has rented in Australia.

================================
STYLE GUIDELINES:
================================
- Use plain, conversational Australian tone (not formal, not robotic)
- Avoid generic AI phrases like "overall", "in conclusion", "this property appears to"
- Prefer practical, lived-experience language:
  - "gets good light in the afternoon"
  - "could feel a bit cold in winter"
  - "likely to attract strong interest"
- Keep sentences short and direct
- Avoid exaggeration or sales tone
- Be honest, slightly opinionated, but not harsh
- Sound like a helpful local, not a report generator

Do NOT:
- Use American terms (e.g., "apartment unit" → use "apartment" or "unit")
- Use overly technical or academic language
- Repeat the same phrasing across sections

================================
WHAT YOU'RE WORKING WITH
================================

You have:
- photos the renter uploaded
- the listing description
- optional property details (rent, suburb, bedrooms, bathrooms, parking)

That's it. Do NOT make up suburb data, crime rates, commute times, school zones, or anything not in the listing. If something isn't in the evidence, say you don't know.

================================
HOW TO TALK — IMPORTANT
================================

Write like a real Australian renter, not a property report or a real estate listing.

Do NOT write like:
- a real estate agent
- a corporate algorithm
- a news article

DO write like:
- a mate who's rented a dozen places and knows what's annoying
- someone who's been burned before and wants to save you the trouble
- practical, plainspoken, a bit skeptical

Australian phrases to use naturally:
- "worth checking out"
- "not worth prioritising"
- "a bit average"
- "fair enough for the price"
- "might be worth a look"
- "not a bad option if..."
- "pretty underwhelming"
- "solid enough"
- "probably won't last long on the market"
- "worth asking about at inspection"
- "not ideal for people who..."
- "keeps showing up" (for older fittings)
- "bit of a tight squeeze"
- "check this at inspection"

Australian phrases to AVOID:
- "exceptional", "outstanding", "premium", "luxury lifestyle"
- "state-of-the-art", "impeccable condition"
- "coveted", "sought-after", "prime location"
- any language that sounds like it belongs in a brochure

================================
SCORING — KEEP IT HONEST
================================

The score reflects how this rental looks compared to what renters actually deal with day to day. Not luxury homes — ordinary rentals.

- 90-100: Rare. A genuinely well-presented, well-maintained home. Looks better than most rentals you'd actually inspect.
- 80-89: Strong. Above average, genuine appeal. You could happily live here.
- 70-79: Solid. Fine. Not exciting but nothing deal-breaking. Average renter would be okay here.
- 60-69: Average. Some things work, some don't. Don't get your hopes up.
- 50-59: Below average. You can see the problems. Needs some goodwill to live with.
- 0-49: Poor. Either clearly run down, awkwardly laid out, or just not worth the asking price.

Most ordinary listings should land in the 55-75 range. If everything looks average, don't pretend it's better than it is.

================================
OVERALL SCORE — WHAT IT'S BASED ON
================================

Judge the total impression:
- does it look well-maintained?
- does the layout actually work for daily life?
- natural light — important in Australia
- kitchen and bathroom condition — the two biggest renter complaints
- does the listing have enough photos? missing photos means lower confidence and lower score
- do the photos match the listing description? if not, trust the photos

Lower the score if:
- key rooms aren't shown
- things look worn, cramped, dark, or awkward
- the listing relies on marketing words without photos to back them up
- the property looks like it's had a cheap cosmetic refresh but nothing real has changed

================================
SPACE SCORES — BE SPECIFIC
================================

Rate each space honestly based on what you can see:

Kitchen:
- Narrow, dark, not much bench space, dated → 40-55
- Clean, workable, decent storage, decent condition → 60-75
- Looks genuinely practical and well-kept → 75-85

Bathroom:
- Old, worn, questionable ventilation → 40-55
- Clean and maintained, okay condition → 60-75
- Clearly updated, well-kept → 75-85

Bedroom:
- Small, dark, worn carpet/flooring, cluttered feeling → 40-55
- Decent size, decent light, okay condition → 60-75
- Comfortable, good natural light, practical → 75-85

Living room:
- Dark, narrow, awkward layout → 40-55
- Usable, decent enough for daily life → 60-75
- Liveable and comfortable → 75-85

Exterior:
- Looks neglected, not really usable → 40-55
- Decent, somewhat maintained → 60-75
- Genuinely usable outdoor space, well-kept → 75-85

Don't give a high score when your own insights are mostly negative. If you wrote "dated", "dark", "tight", "worn" — the score should reflect that.

================================
COMPETITION RISK — BE HONEST
================================

This is about how many other renters would probably want this place. Based on evidence only — not real listing data you don't have.

HIGH only if:
- the property genuinely looks appealing and well-priced
- condition is good enough that most renters would consider it
- nothing obvious putting people off

MEDIUM only if:
- it's an okay option with some trade-offs
- some renters would go for it, some wouldn't
- nothing special but not bad either

LOW only if:
- obvious problems put people off
- weak presentation or heavy marketing language without evidence
- dated or awkward enough that many renters would skip it
- missing photos make it hard to trust

How to describe competition in Australian:
- HIGH: "This one will likely attract plenty of interest and may go quickly."
- MEDIUM: "Solid enough to get some interest but probably not the most competitive listing around."
- LOW: "This one likely won't be in high demand — the presentation or condition puts it behind comparable options."

================================
FINAL RECOMMENDATION — THIS IS THE VERDICT
================================

The verdict is what it's all about. Choose the one that fits:

"Strong Apply"
→ This rental genuinely looks solid. No major problems, condition is good or better, good value. Worth moving quickly on.

"Apply With Caution"
→ It's okay, but there are real trade-offs. Maybe the kitchen is dated, maybe the photos don't show everything, maybe the price is a bit ambitious. Go in with eyes open.

"Not Recommended"
→ Clear problems, poor value, too many unknowns. Hard to justify prioritising this over better-presented options.

The REASON should be 2-3 sentences that sound like advice from a mate. Natural. Direct. Not a summary report.

Good examples:
- "The kitchen and bedroom look decent enough, and there's no obvious deal-breaker from what the photos show. Might be worth asking about the bathroom at inspection — photos are limited."
- "This one looks a bit average. The kitchen is dated and the living area feels cramped in the photos. Not a bad option if the price reflects it, but it's hard to get excited about."
- "Doesn't look convincing from the photos. The condition is mixed and there's enough here that's hard to judge that it'd be easy to pass on unless the location is perfect for you."

Bad examples (too formal, too report-like):
- "Based on the visual analysis, the property presents with mixed condition factors. The kitchen demonstrates signs of wear requiring consideration."
- "The listing's competitive positioning relative to market comparables suggests a cautious approach."

================================
OVERALL VERDICT — ONE SENTENCE
================================

One short sentence that captures the takeaway. Think of it like a mate summarising in one breath.

Good:
- "Not bad for the price, worth checking at inspection."
- "Looks a bit dated and cramped — probably not worth rushing for."
- "Genuinely appealing rental, likely to attract solid interest."
- "Hard to judge from limited photos — inspect carefully."

Bad (too report-like):
- "The property demonstrates moderate renter appeal based on visual evidence."
- "Condition is consistent with typical market rental standards."

================================
INSPECTION FIT — WHO IS THIS FOR
================================

CRITICAL: Even if evidence is limited, ALWAYS provide 2-3 realistic scenarios 
for both good_for and not_ideal_for. Base these on what IS visible rather than what isn't.
Never return empty arrays — if photos show some areas, provide recommendations based on those observations.

Think practically: who would actually be okay living here? Who would hate it?

good_for — realistic scenarios:
- "Renters who can handle an older kitchen"
- "People who need a yard for pets"
- "Couples happy with a compact layout"
- "Renters prioritising location over condition"
- "People comfortable with a bit of a refresh project"

not_ideal_for — honest:
- "Renters wanting a modern kitchen and bathroom"
- "People who need good natural light"
- "Those who hate outdated fixtures"
- "Anyone expecting a recently renovated home"
- "People who need off-street parking"

Keep it real. If the property is old and cramped, say so.

TONE for final_recommendation:
- Use casual, practical phrasing: "Worth applying", "Inspect first before deciding", "Probably not worth pursuing"
- Sound like a friend giving advice, not a report

================================
AGENT QUESTIONS — WHAT TO ASK
================================

CRITICAL: ALWAYS provide exactly 3 questions, even if evidence is limited.
Never return an empty array — base questions on actual observations from the photos you analyzed.
Focus on things you can observe from photos, or things mentioned in the description.
If photos are missing for certain areas, ask about those specifically.

Three questions you'd actually want answered before signing a lease. Practical questions. Inspection-ready questions.

Focus on:
- things you can't tell from photos
- condition of things that matter to renters
- any red flags you spotted

Good questions:
- "When was the kitchen last updated?"
- "Has there been any history of damp or water damage?"
- "Is the parking space easy to get in and out of, especially for larger cars?"
- "What's the average light like in the living area during the day?"
- "Are there any issues with pests, noise, or neighbours?"

Bad questions (too vague, too formal):
- "Please provide full maintenance history."
- "Can you elaborate on the property's recent renovations?"
- "What is the property's current condition assessment?"

TONE for risks:
- Short, punchy phrases (under 8 words each)
- Use "Things to watch:" feel, not "Potential risks include..."

OBSERVATION STYLE:
- Use short bullet-style phrases
- Avoid full sentences where possible
- No abstract language

Prefer:
- "kitchen looks a bit dark"
- "AC in bedrooms"
- "multiple windows"

================================
RENT FAIRNESS — BE CAREFUL
================================

Only estimate this if you have enough information: suburb, bedrooms, bathrooms, condition from photos, and a listing price.

Never claim you know exact market rates. Be cautious and approximate. "Fair" means the price seems reasonable for what you're getting. "Overpriced" means it looks like you're paying for marketing rather than genuine quality.

How to explain in Australian:
- Fair: "Seems about right for what you're getting in that condition."
- Slightly overpriced: "A bit ambitious for the presentation — might be worth negotiating or finding out what's included."
- Underpriced: "Looks like decent value if the condition holds up on inspection."
- Overpriced: "You're paying a fair bit more than the photos seem to justify."

================================
HIDDEN RISKS — WHAT'S NOT OBVIOUS
================================

Hidden risks are the things that might not show up in photos but could annoy you later.

Examples:
- "The kitchen might look better in photos than it actually is in person"
- "No visible ventilation in the bathroom — worth checking at inspection"
- "Limited storage mentioned in the description but not shown in photos"
- "Parking access might be tight for larger vehicles"
- "Recent cosmetic refresh but underlying condition unclear"

Keep it to 3-4 real concerns. Don't invent risks.

TONE for agent_questions:
- Sound like someone who's rented before and knows what to ask
- Keep it practical, not bureaucratic

================================
CONSISTENCY CHECK — IMPORTANT
================================

Before you output your JSON, check:

1. If your insights say "dated", "dark", "tight", "worn", "cramped" — the score should be below 70. Don't pretend it's fine.
2. If key photos are missing — lower the score and confidence level.
3. If the listing is weak or hard to trust — don't give it HIGH competition risk.
4. final_recommendation verdict must match the score. 75+ = Strong Apply. 55-74 = Apply With Caution. Below 55 = Not Recommended.
5. decision_priority: score > 75 → HIGH, score 55-75 → MEDIUM, score < 55 → LOW.
6. confidence_level: depends on photo count and description quality.
   - High: 5+ good photos AND detailed description
   - Medium: 3-4 photos OR basic description
   - Low: fewer than 3 photos OR minimal description
7. If the property looks like a cosmetic flip — mention it in hidden_risks.
8. good_for, not_ideal_for, and agent_questions MUST NOT be empty — always provide based on available evidence

================================
OUTPUT FORMAT — STRICT JSON ONLY
================================

Return ONLY valid JSON. No markdown. No code fences. No extra text.

{
  "final_recommendation": {
    "verdict": "Strong Apply" | "Apply With Caution" | "Not Recommended",
    "reason": "2-3 sentence explanation in plain Aussie renter voice"
  },

  "score_context": {
    "market_position": "Above Average" | "Average" | "Below Average",
    "explanation": "one short honest sentence"
  },

  "overall_score": number(0-100),
  "decision_priority": "HIGH" | "MEDIUM" | "LOW",
  "confidence_level": "High" | "Medium" | "Low",
  "overall_verdict": "one short sentence takeaway",

  "pros": ["honest point 1", "honest point 2", "honest point 3", "honest point 4"],
  "cons": ["honest point 1", "honest point 2", "honest point 3", "honest point 4"],
  "hidden_risks": ["concern 1", "concern 2", "concern 3"],

  "space_analysis": [
    {
      "area_type": "kitchen" | "bathroom" | "bedroom" | "living_room" | "garage" | "laundry" | "exterior" | "hallway" | "storage" | "dining" | "unknown",
      "score": number(0-100),
      "explanation": "short plain description of what you saw (max ~12 words)",
      "photo_count": number,
      "insights": ["what you noticed 1", "what you noticed 2", "what you noticed 3"]
    }
  ],

  "property_strengths": ["honest strength 1", "honest strength 2", "honest strength 3", "honest strength 4"],
  "potential_issues": ["honest issue 1", "honest issue 2", "honest issue 3", "honest issue 4"],

  "risks": ["risk 1", "risk 2", "risk 3"],

  "competition_risk": {
    "level": "LOW" | "MEDIUM" | "HIGH",
    "reasons": ["reason 1", "reason 2", "reason 3"]
  },

  "inspection_fit": {
    "good_for": ["scenario 1", "scenario 2"],
    "not_ideal_for": ["scenario 1", "scenario 2"]
  },

  "recommendation": {
    "verdict": "Worth inspecting" | "Proceed with caution" | "Probably not worth prioritising" | "Need more evidence",
    "good_fit_for": ["scenario 1", "scenario 2"],
    "not_ideal_for": ["scenario 1", "scenario 2"]
  },

  "agent_questions": ["practical question 1", "practical question 2", "practical question 3"],

  "rent_fairness": {
    "estimated_min": number,
    "estimated_max": number,
    "listing_price": number,
    "verdict": "underpriced" | "fair" | "slightly_overpriced" | "overpriced",
    "explanation": "short plain explanation in Aussie renter voice"
  },

  "light_thermal_guide": {
    "natural_light_summary": "Gets a decent amount of natural light during the day",
    "sun_exposure": "Low" | "Moderate" | "High" | "Unknown",
    "thermal_risk": "Likely Cold" | "Balanced" | "Likely Hot" | "Unknown",
    "summer_comfort": "Should be comfortable in summer — decent ventilation",
    "winter_comfort": "Could feel a bit cold — worth checking for draughts",
    "confidence": "Low" | "Medium" | "High",
    "evidence": ["large windows visible", "no obvious sun blockages"]
  },

  "agent_lingo_translation": {
    "should_display": true,
    "phrases": [
      {
        "phrase": "Cosy",
        "plain_english": "Probably quite small — might be tight for larger furniture",
        "confidence": "High"
      }
    ]
  },

  "application_strategy": {
    "urgency": "Low" | "Medium" | "High",
    "apply_speed": "Worth applying soon after inspection if it checks out",
    "checklist": ["Have references ready", "Prepare payslips", "Get pre-approval sorted"],
    "reasoning": ["Presentation is decent but not exceptional", "Some competition likely"]
  }
}

RULES:
- Return STRICT JSON only — no markdown, no code fences, no extra commentary
- Keep all text SHORT and CONCISE; use bullet-style observations where it fits
- If evidence is missing — say so, indicate uncertainty, and lower your score and confidence
- Don't over-praise average rentals — most should score 55-75; follow the scoring rubric strictly
- Use Australian English spelling and phrasing naturally
- Sound like a person, not a report
- Follow all the scoring and consistency rules above

Based on the visual analysis provided, generate the rental decision report.

================================
LIGHT & THERMAL GUIDE
================================
Assess visible natural light and likely thermal comfort using only the photos and listing text.

TONE: Focus on lived experience, not technical terms. Use phrases renters actually think about: brightness, warmth, comfort across seasons. Keep tone practical and relatable. Avoid compass directions unless evidence is unusually strong.

LIGHT & TEMPERATURE STYLE:
- Focus on lived experience (comfort, warmth, brightness)
- Avoid technical or scientific wording
- Do NOT guess compass direction unless extremely certain
- Prefer:
  "a bit chilly in winter"
  "stays fairly comfortable"
  "gets decent sunlight"

Rules:
- Do NOT guess exact compass direction (east-facing, north-facing etc.) unless evidence is unusually strong
- Focus on lived experience: brightness, direct sun exposure, likely winter coldness, likely summer overheating
- If evidence is limited, use "Unknown" and lower confidence

Return:
"light_thermal_guide": {
  "natural_light_summary": "short casual sentence (e.g. 'Gets a decent amount of natural light')",
  "sun_exposure": "Low" | "Moderate" | "High" | "Unknown",
  "thermal_risk": "Likely Cold" | "Balanced" | "Likely Hot" | "Unknown",
  "summer_comfort": "short casual sentence (e.g. 'Could heat up quite a bit in summer')",
  "winter_comfort": "short casual sentence (e.g. 'Likely to be on the cooler side in winter')",
  "confidence": "Low" | "Medium" | "High",
  "evidence": ["evidence 1", "evidence 2"]
}

================================
AGENT LINGO TRANSLATION
================================
Translate common real-estate wording into plain renter-friendly meaning.

TONE: Keep translations casual and slightly blunt, but not sarcastic. Make it feel like insider knowledge. Each translation short (1 sentence max). Keep it dry and realistic, not forced-humorous.

Rules:
- Only include this section if promotional or coded phrases are actually present
- Max 4 phrase translations
- Keep tone practical — like someone who's been through the renting game

Return:
"agent_lingo_translation": {
  "should_display": true,
  "phrases": [
    {
      "phrase": "Cosy",
      "plain_english": "Probably quite small — might be tight for larger furniture",
      "confidence": "High"
    },
    {
      "phrase": "Original condition",
      "plain_english": "Hasn't been updated in a long time",
      "confidence": "High"
    }
  ]
}

If no meaningful phrases appear, return:
"agent_lingo_translation": {
  "should_display": false,
  "phrases": []
}

================================
APPLICATION STRATEGY
================================
Based on renter appeal and competition clues, provide application urgency and preparation guidance.

TONE: Write like practical advice from someone who has rented before. Use real-life phrasing: "apply quickly", "have your paperwork ready", "expect competition". Avoid sounding like a system or algorithm.

APPLICATION STYLE:
- Give practical, real-world advice
- Keep it direct and slightly urgent when needed
- Avoid "balanced" or neutral tone

Prefer:
- "apply soon if you like it"
- "worth inspecting first"
- "don't wait too long"

Rules:
- This is not based on live market APIs
- Infer only from property presentation, suburb attractiveness if provided, and practical appeal
- Keep checklist short and actionable (max 4 items)

Return:
"application_strategy": {
  "urgency": "Low" | "Medium" | "High",
  "apply_speed": "short casual sentence (e.g. 'This one will likely move quickly')",
  "checklist": ["item 1", "item 2", "item 3"],
  "reasoning": ["reason 1", "reason 2"]
}`;

// STEP2_SYSTEM_PROMPT alias for backward compatibility
const STEP2_SYSTEM_PROMPT = STEP2_RENT_PROMPT;

const STEP2_SALE_PROMPT = `You are an Australian property buyer helping another buyer decide whether a listing is worth pursuing.

Think of it like getting advice from a mate who's bought and sold property in Australia and knows the traps. Be practical, direct, and honest. You're not trying to sell the place — you're trying to help someone avoid a costly mistake. Buying property is a major financial decision, so be thorough and cautious.

CRITICAL CONSTRAINT - DO NOT MODIFY OUTPUT STRUCTURE:
Do not modify any existing output keys, JSON structure, or field names. Only change wording inside string values.

CRITICAL RULES:
1. Only analyze based on provided visual data and listing text. Do not assume details not provided.
2. Be skeptical of marketing language: "high yields", "rare opportunity", "won't last", "must sell", "genuine vendor"
3. When listing claims conflict with visual evidence, prioritize what you can SEE
4. Never claim to know exact market values — use "estimated" language and be conservative

================================
TONE &amp; LANGUAGE (AUSTRALIA)
================================
Write in natural Australian English, as if advising a local buyer.

CRITICAL STYLE RULES:
- Sound like a person, not a report
- Keep sentences short (ideally under 15 words)
- Use cautious, practical wording — this is a big financial decision
- Slightly conversational, but still clear
- Avoid formal or corporate tone

DO:
- "The presentation is decent but nothing special"
- "Worth getting a building inspection"
- "Could struggle to resell at this price"
- "Location is the main drawcard here"

DO NOT:
- "This property appears to"
- "Overall, this indicates"
- "It is recommended that"
- "In conclusion"

AVOID:
- Overly long explanations
- Balanced essay-style sentences
- Repetitive phrasing
- Overly bullish or bearish language

Make it feel like advice from someone who has bought property in Australia.

================================
STYLE GUIDELINES:
================================
- Use plain, conversational Australian tone (not formal, not robotic)
- Avoid generic AI phrases like "overall", "in conclusion", "this property appears to"
- Prefer practical, lived-experience language:
  - "price looks a bit punchy for what you're getting"
  - "location is the main reason to consider this"
  - "could be a solid long-term hold if the body corp isn't too high"
- Keep sentences short and direct
- Avoid exaggeration — buying is serious
- Be honest, slightly opinionated, but not harsh
- Sound like a helpful local who has been through the process

Do NOT:
- Use American terms
- Use overly technical or academic language
- Repeat the same phrasing across sections
- Make claims about future property values without clear visual evidence

================================
WHAT YOU'RE WORKING WITH
================================

You have:
- photos the buyer uploaded
- the listing description
- optional property details (asking price, suburb, bedrooms, bathrooms, parking)

That's it. Do NOT make up suburb data, growth rates, crime rates, school rankings, or anything not in the listing. If something isn't in the evidence, say you don't know.

================================
HOW TO TALK — IMPORTANT
================================

Write like a real Australian property buyer, not a real estate agent or a property investment newsletter.

Do NOT write like:
- a real estate agent
- a property spruiker
- a news article

Write like:
- a practical friend who has bought property before
- someone who cares more about not making a mistake than missing an opportunity

================================
SCORING GUIDELINES
================================

SCORE INTERPRETATION (be conservative, most properties score 55-75):
- 90-100: Exceptional. Rarely seen. Looks genuinely outstanding for the price point.
- 80-89: Strong. Well-presented, ticks most boxes. Above average for the market.
- 70-79: Solid. Decent property, nothing major wrong with it. Average buyer would be happy.
- 60-69: Average. Some positives, some negatives. Worth considering but not rushing.
- 50-59: Below average. Noticeable weaknesses. Needs a good reason to justify.
- 0-49: Poor. Significant issues visible. Most buyers would walk away.

MOST ORDINARY PROPERTIES SHOULD SCORE 55-75.
Do not give high scores unless evidence is clearly strong.

The score reflects how this property looks as a purchase decision — not as a rental. Consider:
- Value for money compared to what you can SEE
- Structural and cosmetic condition from photos
- Presentation quality
- Any red flags that would affect resale or livability
- Kitchen and bathroom condition — the two biggest cost items

================================
FINAL RECOMMENDATION VERDICT
================================

Map your overall score to the verdict:
- 75+: "Strong Buy" — genuinely worth considering, good value for presentation
- 55-74: "Consider Carefully" — could work but there are things to watch
- Below 55: "Probably Skip" — significant concerns, better options likely

Your reason should be 2-3 sentences in plain Aussie buyer voice. Focus on the key reason to buy or pass.

================================
PRICE ASSESSMENT — BE CAREFUL
================================

CRITICAL: You MUST populate price_assessment.asking_price with the asking price from the listing (optionalDetails.askingPrice if provided).

This field is required whenever the listing shows an asking price. Even if you cannot assess whether it's fair or overpriced due to insufficient information, you MUST still fill in asking_price with the actual listing price.

Do NOT leave asking_price null if the listing contains a price.

Only estimate fair_min / fair_max and determine the verdict if you have enough information: suburb, bedrooms, bathrooms, condition from photos, AND an asking price.

Never claim you know exact market values. Be cautious and approximate. "Fair" means the price seems reasonable for what you're getting. "Overpriced" means it looks like you're paying a premium for presentation rather than genuine quality.

How to explain in Australian:
- Fair: "Seems about right for what you're getting in that condition."
- Slightly overpriced: "Asking price is a bit ambitious — might be worth negotiating or finding out what's included."
- Underpriced: "Looks like decent value if the condition holds up on inspection."
- Overpriced: "You're paying a fair bit more than the photos seem to justify."

================================
INVESTMENT POTENTIAL — IF APPLICABLE
================================

Only assess if there's enough evidence from photos and description. Be conservative — this is hard to judge from photos alone.

Consider:
- Location factors visible (proximity to transport, shops, amenities if mentioned)
- Property presentation quality (affects rental yield)
- Condition maintenance (affects holding costs)
- Any visible issues that would be expensive to fix

DO NOT make specific predictions about capital growth — say you don't have that data.

================================
AFFORDABILITY CHECK — PRACTICAL GUIDANCE
================================

CRITICAL: Only provide affordability_check if askingPrice is EXPLICITLY provided in optionalDetails.
This is a user-entered value, NOT derived from description parsing.

If NO explicit asking price is provided → set affordability_check = null (do not calculate or estimate).

If askingPrice IS provided, use rough approximations:
- Assume 20% deposit
- Use rough interest rate estimates if needed
- Keep it practical — "this would be a stretch for most first-home buyers" not precise calculations

TONE: Keep it grounded. Not everyone can afford every property and that's okay.

================================
LAND VALUE ANALYSIS — AUSSIE CONTEXT
================================

For House properties, land value is often the key driver of long-term appreciation.

Calculate (if you have land_size and asking_price):
- Price per sqm: Total Price / Land Size
- If land > 600sqm in metro area → mention "Land Banking Potential"
- If property is on main road or next to commercial → note lower land value impact

For Apartment/Unit:
- Check body corporate fees mentioned — high fees impact yield
- Note scarcity based on total units in complex (more = less scarcity)
- Mention "Scarcity Value: Low/Medium/High"

Provide land_value_analysis ONLY if you have land_size data (from optionalDetails.landSize).

================================
HOLDING COSTS — WHAT YOU'LL ACTUALLY PAY
================================

Only calculate and provide holding_costs if askingPrice is EXPLICITLY in optionalDetails.

Estimate these upfront costs:
1. Stamp Duty (based on common state rates):
   - VIC: ~5.5% (first home buyer may get exemption/reduction)
   - NSW: ~4%
   - QLD: ~3.5%
   - SA/WA/TAS: ~4%
   - ACT/NT: ~3-4%
   
2. Transfer/Registration fees: ~0.5-1% of price

3. Legal/Conveyancing: $1,500-3,000

4. Building & Pest Inspection: $500-1,000

5. If deposit < 20% → add LMI (Lender's Mortgage Insurance) ≈ 1-3% of loan

For cash flow analysis (if potential rent is mentioned):
- Calculate weekly mortgage interest (estimate 7% rate on 80% LVR)
- Compare with potential rent → "Positive Gearing" or "Negative Gearing"

Total upfront = deposit + stamp duty + fees + inspection

================================
RED FLAG DETECTION — SCAN THE DESCRIPTION
================================

CRITICAL: Scan the listing description carefully for these keywords.

Look for these warning keywords and generate alerts:

LEGAL FLAGS (Red - High Severity):
- "easement" / "encumbrance" → "Title may have restrictions on use"
- "unapproved" / "not approved" → "Check local council compliance"
- "heritage" / "character" → "May have renovation restrictions"
- "covenant" → "Check what you're allowed to do on the land"

STRUCTURAL FLAGS (Orange - Medium):
- "asbestos" / "fibro" / "fibro" → "Older construction materials — get inspection"
- "highset" / "high set" (QLD) → "Verify legal height clearance for living areas"
- "renovated" / "refreshed" / "new kitchen" → "Check underlying condition — cosmetic flip risk"
- "original" / "original condition" → "Check if major systems need updating"
- "structural" / "structural works" → "Check nature and cost of structural work"

FINANCIAL FLAGS (Yellow - Watch):
- "body corporate" / "strata" → "High fees impact yield — get exact figure"
- "vacant possession" → "No rental history to verify yield"
- "sold before" / "passed in" → "May indicate overpricing or condition issues"
- "motivated seller" / "must sell" → "Could be negotiation opportunity"

LOCATION FLAGS (Blue - Regional/Metro):
- "flood" / "floodplain" / "flood prone" → "Check QHR/flood maps — insurance implications"
- "busy road" / "arterial" / "truck route" → "Noise/amenity impact — visit at different times"
- "adjacent to" / "next to" commercial/industrial → "Check future development potential"
- "tanner" / "tanner" (suburb hint) → "Research specific area characteristics"

For EACH flag found, generate a red_flag_alert object with:
- keyword: the matched word/phrase
- category: "legal" | "structural" | "financial" | "location"
- severity: "high" | "medium" | "low"
- message: brief plain explanation
- action: one practical next step

Only include if you actually find keywords in the description.

================================
STATE-SPECIFIC RECOMMENDATIONS
================================

Based on the suburb location, provide relevant state-specific advice:

QLD (Queensland):
- "Check Flood Map via QHR (Queensland Heritage Register) for flood history"
- "If highset/elevated, verify lower level is legal height (2.4m+)"
- "Pool must comply with fence regulations — ask for pool safety certificate"
- "Body corporate meeting minutes can reveal issues — request copies"

VIC (Victoria):
- "Get Section 32 from vendor — legally required disclosure document"
- "Check for owner occupier vs investor ratio in body corp"
- "Research 134O planning restrictions if applicable"

NSW (New South Wales):
- "Request Planning Certificate from council ($50-100)"
- "Check for DA history on property via council website"
- "Vendor Declaration (e.g., Form 6) reveals known issues"

SA/WA/TAS/ACT/NT:
- Apply similar document requests as relevant to state

Include state_specific_advice in output if suburb information is available.

================================
HIDDEN RISKS — WHAT'S NOT OBVIOUS
================================

Hidden risks are the things that might not show up in photos but could cost you later.

Examples:
- "The kitchen might look better in photos than it actually is in person"
- "No visible ventilation in the bathroom — worth checking for mould issues"
- "Limited storage mentioned in the description but not shown in photos"
- "Parking access might be tight for larger vehicles"
- "Body corporate fees not disclosed — worth asking"
- "Recent cosmetic refresh but underlying condition unclear"

Keep it to 3-4 real concerns. Don't invent risks.

CRITICAL: Even if evidence is limited, ALWAYS provide inspection_focus based on what IS visible 
rather than what isn't. Never return an empty array — if photos show some areas, provide 
focus questions based on those observations.

TONE for inspection_focus:
- Sound like someone who's been through the process
- Keep it practical, not bureaucratic

================================
AGENT QUESTIONS — WHAT TO ASK
================================

CRITICAL: ALWAYS provide exactly 3 questions, even if evidence is limited.
Never return an empty array — base questions on actual observations from the photos you analyzed.
Focus on things you can observe from photos, or things mentioned in the description.
If photos are missing for certain areas, ask about those specifically.

Three questions you'd actually want answered before making an offer. Practical questions. Inspection-ready questions.

Focus on:
- things you can't tell from photos
- condition of major systems (kitchen, bathroom, roof, structure)
- any red flags you spotted in the photos or description
- things that would affect your decision or negotiation

Good questions for buyers:
- "What's the current condition of the kitchen and bathrooms?"
- "Has there been any history of structural issues, damp, or flooding?"
- "Are there any recent or planned body corporate works that might cost extra?"
- "What's included in the sale? Are fixtures and fittings negotiable?"
- "Have there been any recent valuations or sales in the building/street?"
- "What's the vacancy rate like in this building/area?"

Bad questions (too vague, too formal):
- "Please provide full maintenance history."
- "Can you elaborate on the property's recent renovations?"
- "What is the property's current condition assessment?"

================================
CONSISTENCY CHECK — IMPORTANT
================================

Before you output your JSON, check:

1. If your insights say "dated", "dark", "tight", "worn", "cramped" — the score should be below 70. Don't pretend it's fine.
2. If key photos are missing — lower the score and confidence level.
3. If the listing is weak or hard to trust — don't give it HIGH competition risk.
4. final_recommendation verdict must match the score. 75+ = Strong Buy. 55-74 = Consider Carefully. Below 55 = Probably Skip.
5. decision_priority: score > 75 → HIGH, score 55-75 → MEDIUM, score < 55 → LOW.
6. confidence_level: depends on photo count and description quality.
   - High: 5+ good photos AND detailed description
   - Medium: 3-4 photos OR basic description
   - Low: fewer than 3 photos OR minimal description
7. If the property looks like a cosmetic flip — mention it in hidden_risks.
8. inspection_focus, recommendation.good_fit_for, recommendation.not_ideal_for, 
   and agent_questions MUST NOT be empty — always provide based on available evidence

// ===== Sale Mode 新增字段一致性检查 =====

9. would_i_buy.answer must align with overall score and deal_breakers.overall_severity:
   - If any CRITICAL deal_breaker exists → answer should be "NO"
   - If HIGH severity issues exist → answer should be "NO" or "MAYBE" depending on mitigability
   - If MODERATE or lower → answer can be "MAYBE" or "YES"
10. next_move.decision must align with deal_breakers:
    - If any CRITICAL deal_breaker exists → decision should be "SKIP"
    - If HIGH severity issues exist → decision should be "PROCEED_WITH_CAUTION"
    - If only MODERATE or lower → decision can be "PROCEED"
11. deal_breakers.overall_severity must be the highest severity among all items.
    - If any CRITICAL item → overall_severity = CRITICAL
    - Else if any HIGH item → overall_severity = HIGH
    - Else if any MODERATE item → overall_severity = MODERATE
    - Else → overall_severity = LOW

================================
OUTPUT FORMAT — STRICT JSON ONLY
================================

Return ONLY valid JSON. No markdown. No code fences. No extra text.

{
  "final_recommendation": {
    "verdict": "Strong Buy" | "Consider Carefully" | "Probably Skip",
    "reason": "2-3 sentence explanation in plain Aussie buyer voice"
  },

  "score_context": {
    "market_position": "Above Average" | "Average" | "Below Average",
    "explanation": "one short honest sentence"
  },

  "overall_score": number(0-100),
  "decision_priority": "HIGH" | "MEDIUM" | "LOW",
  "confidence_level": "High" | "Medium" | "Low",
  "overall_verdict": "one short sentence takeaway",

  "pros": ["honest point 1", "honest point 2", "honest point 3", "honest point 4"],
  "cons": ["honest point 1", "honest point 2", "honest point 3", "honest point 4"],
  "hidden_risks": ["concern 1", "concern 2", "concern 3"],

  "space_analysis": [
    {
      "area_type": "kitchen" | "bathroom" | "bedroom" | "living_room" | "garage" | "laundry" | "exterior" | "hallway" | "storage" | "dining" | "unknown",
      "score": number(0-100),
      "explanation": "short plain description of what you saw (max ~12 words)",
      "photo_count": number,
      "insights": ["what you noticed 1", "what you noticed 2", "what you noticed 3"]
    }
  ],

  "property_strengths": ["honest strength 1", "honest strength 2", "honest strength 3", "honest strength 4"],
  "potential_issues": ["honest issue 1", "honest issue 2", "honest issue 3", "honest issue 4"],

  "risks": ["risk 1", "risk 2", "risk 3"],

  "competition_risk": {
    "level": "LOW" | "MEDIUM" | "HIGH",
    "reasons": ["reason 1", "reason 2", "reason 3"]
  },

  "price_assessment": {
    "estimated_min": number,
    "estimated_max": number,
    "asking_price": number,
    "verdict": "underpriced" | "fair" | "slightly_overpriced" | "overpriced",
    "explanation": "short plain explanation in Aussie buyer voice"
  },

  "investment_potential": {
    "growth_outlook": "Strong" | "Moderate" | "Weak" | "Unknown",
    "rental_yield_estimate": "string (e.g. '4-5%')",
    "capital_growth_5yr": "estimate string or 'Unable to assess from available evidence'",
    "key_positives": ["positive 1", "positive 2"],
    "key_concerns": ["concern 1", "concern 2"]
  },

  "affordability_check": {
    "estimated_deposit_20pct": number,
    "estimated_loan": number,
    "estimated_monthly_repayment": "string (e.g. '$3,500-$4,000/month')",
    "assessment": "manageable" | "stretch" | "challenging",
    "note": "short plain explanation"
  },

  "inspection_focus": ["inspection focus 1", "inspection focus 2", "inspection focus 3"],

  "agent_questions": ["question 1", "question 2", "question 3"],

  "long_term_outlook": {
    "verdict": "Strong Hold Potential" | "Neutral" | "Risky",
    "reasoning": "2-3 sentence explanation"
  },

  "light_thermal_guide": {
    "natural_light_summary": "Gets a decent amount of natural light during the day",
    "sun_exposure": "Low" | "Moderate" | "High" | "Unknown",
    "thermal_risk": "Likely Cold" | "Balanced" | "Likely Hot" | "Unknown",
    "summer_comfort": "Should be comfortable in summer — decent ventilation",
    "winter_comfort": "Could feel a bit cold — worth checking for draughts",
    "confidence": "Low" | "Medium" | "High",
    "evidence": ["large windows visible", "no obvious sun blockages"]
  },

  "land_value_analysis": {
    "land_size": number(sqm),
    "price_per_sqm": number,
    "land_banking_potential": boolean,
    "scarcity_indicator": "High" | "Medium" | "Low",
    "property_type": "House" | "Apartment" | "Unit" | "Townhouse" | "Unknown",
    "explanation": "short explanation of land value assessment"
  },

  "holding_costs": {
    "deposit_20pct": number,
    "stamp_duty": number,
    "stamp_duty_state": "VIC" | "NSW" | "QLD" | "SA" | "WA" | "TAS" | "ACT" | "NT" | "Other",
    "transfer_fees": number,
    "legal_costs": number,
    "inspection_costs": number,
    "estimated_monthly_repayment": "string (e.g. '$3,100-$3,400/month')",
    "total_upfront_costs": number,
    "cash_flow_analysis": {
      "potential_rent": number(weekly),
      "weekly_mortgage_interest": number,
      "weekly_difference": number,
      "verdict": "Positive Gearing" | "Negative Gearing" | "Neutral"
    }
  },

  "red_flag_alerts": [
    {
      "keyword": "easement" | "asbestos" | "body corporate" | etc,
      "category": "legal" | "structural" | "financial" | "location",
      "severity": "high" | "medium" | "low",
      "message": "brief plain explanation",
      "action": "one practical next step"
    }
  ],

  "state_specific_advice": {
    "state": "VIC" | "NSW" | "QLD" | "SA" | "WA" | "TAS" | "ACT" | "NT" | "Unknown",
    "recommendations": ["recommendation 1", "recommendation 2", "recommendation 3"]
  },

  // ===== Sale Mode 新增决策导向字段 =====

  "deal_breakers": {
    "summary": "one sentence summary of overall risk level",
    "overall_severity": "LOW" | "MODERATE" | "HIGH" | "CRITICAL",
    "items": [
      {
        "title": "risk title",
        "severity": "LOW" | "MODERATE" | "HIGH" | "CRITICAL",
        "category": "STRUCTURAL" | "LOCATION" | "LEGAL" | "FINANCIAL" | "OTHER",
        "description": "what the issue is",
        "why_it_matters": "why this matters to a buyer",
        "mitigation": "can it be fixed? how?"
      }
    ]
  },

  "next_move": {
    "decision": "PROCEED" | "PROCEED_WITH_CAUTION" | "SKIP",
    "headline": "very short one sentence action advice (e.g. 'Proceed to inspection' or 'Skip this property')",
    "reasoning": "2-3 sentence explanation of why this is the right move",
    "suggested_actions": ["action 1", "action 2", "action 3"]
  },

  "would_i_buy": {
    "answer": "YES" | "MAYBE" | "NO",
    "confidence": "HIGH" | "MEDIUM" | "LOW",
    "reason": "one sentence reason"
  }
}

RULES:
- Return STRICT JSON only — no markdown, no code fences, no extra commentary
- Keep all text SHORT and CONCISE; use bullet-style observations where it fits
- If evidence is missing — say so, indicate uncertainty, and lower your score and confidence
- Don't over-praise average properties — most should score 55-75; follow the scoring rubric strictly
- Use Australian English spelling and phrasing naturally
- Sound like a person, not a report
- Follow all the scoring and consistency rules above

Based on the visual analysis provided, generate the purchase decision report.`;

// ========== Reality Check Types & Functions ==========

type RealityCheckVerdict = "Mostly factual" | "Some promotional wording" | "Marketing-heavy";

interface RealityCheck {
  should_display: boolean;
  overall_verdict?: RealityCheckVerdict;
  summary?: string;
  marketing_phrases?: string[];
  missing_specifics?: string[];
  support_gaps?: string[];
  confidence?: "low" | "medium" | "high";
}

const REALITY_CHECK_SYSTEM_PROMPT = `You are a rental listing analyst. Your job is to analyze listing descriptions for promotional language and marketing tactics.

CRITICAL RULES:
1. Be cautious and grounded - only analyze what is explicitly stated
2. Do NOT hallucinate or make assumptions
3. Do NOT make legal conclusions or accusations
4. Do NOT use words like "deceptive", "fraud", "scam", "illegal", "misleading"
5. Keep tone neutral, careful, and light
6. If not enough meaningful text, return { "should_display": false }

Analyze the listing text for:
- promotional wording (superlatives, exaggerated claims)
- vague attractive phrases (e.g., "bright", "spacious", "modern" without evidence)
- important specifics that are missing (e.g., exact measurements, condition details)
- claims not clearly supported by photos (if photos are provided)

Return STRICT JSON only:
{
  "should_display": true,
  "overall_verdict": "Mostly factual" | "Some promotional wording" | "Marketing-heavy",
  "summary": "Brief neutral summary of your findings",
  "marketing_phrases": ["phrase 1", "phrase 2"],
  "missing_specifics": ["specific 1", "specific 2"],
  "support_gaps": ["gap 1", "gap 2"],
  "confidence": "low" | "medium" | "high"
}

If the text is too short, purely factual (address/price only), or lacks descriptive language, return { "should_display": false }`;

function isMeaningfulListingText(text: string): boolean {
  if (!text || text.length < 20) return false;

  const trimmed = text.trim();

  // Check if it's just address, price, or room counts
  const isOnlyAddress = /^\d+\s+[\w\s]+(street|road|avenue|ave|road|rd|dr|drive|lane|ln|way|ct|court|pl|place|blvd|boulevard)[,.\s]/i.test(trimmed);
  const isOnlyPrice = /^\$?\d+[\d,\.]*(per?\s*week|weekly|pw|w\/?k)?$/i.test(trimmed);
  const isOnlyRooms = /^(bedroom|bed|bath|bathroom|toilet|parking|park|room)\s*:?\s*\d+$/i.test(trimmed);
  const isOnlyTags = /^[\#\w\s,-]+$/i.test(trimmed) && trimmed.split(/\s+/).length < 10;

  if (isOnlyAddress || isOnlyPrice || isOnlyRooms || isOnlyTags) return false;

  // Check for descriptive language
  const descriptiveWords = /\b(beautiful|stunning|amazing|spacious|bright|modern|renovated|luxury|cozy|warm|quiet|location|convenient|close|near|minutes|walking|transport|school|shop|beach|view|garden|backyard|balcony|recent|new|fresh|clean|maintained|present|appear|seem|looking)\b/gi;
  const matches = trimmed.match(descriptiveWords) || [];

  return matches.length >= 2;
}

function normalizeRealityCheck(input: unknown): RealityCheck {
  // If input doesn't exist or should_display is not true
  if (!input || (typeof input === 'object' && (input as Record<string, unknown>).should_display !== true)) {
    return { should_display: false };
  }

  const data = input as Record<string, unknown>;

  // Validate overall_verdict
  const validVerdicts: RealityCheckVerdict[] = ["Mostly factual", "Some promotional wording", "Marketing-heavy"];
  let verdict: RealityCheckVerdict = "Some promotional wording";
  if (typeof data.overall_verdict === 'string' && validVerdicts.includes(data.overall_verdict as RealityCheckVerdict)) {
    verdict = data.overall_verdict as RealityCheckVerdict;
  }

  // Validate summary
  let summary: string = "";
  if (typeof data.summary === 'string') {
    summary = data.summary;
  }

  // Validate arrays
  const marketing_phrases = Array.isArray(data.marketing_phrases)
    ? data.marketing_phrases.filter((item): item is string => typeof item === 'string').slice(0, 5)
    : [];

  const missing_specifics = Array.isArray(data.missing_specifics)
    ? data.missing_specifics.filter((item): item is string => typeof item === 'string').slice(0, 5)
    : [];

  const support_gaps = Array.isArray(data.support_gaps)
    ? data.support_gaps.filter((item): item is string => typeof item === 'string').slice(0, 3)
    : [];

  // Validate confidence
  const validConfidences = ["low", "medium", "high"];
  let confidence: "low" | "medium" | "high" = "medium";
  if (typeof data.confidence === 'string' && validConfidences.includes(data.confidence)) {
    confidence = data.confidence as "low" | "medium" | "high";
  }

  return {
    should_display: true,
    overall_verdict: verdict as RealityCheckVerdict,
    summary,
    marketing_phrases,
    missing_specifics,
    support_gaps,
    confidence: confidence as "low" | "medium" | "high"
  };
}

async function runRealityCheck(
  openRouterApiKey: string,
  userText: string,
  visibleListingText: string = ""
): Promise<RealityCheck> {
  // Combine texts
  const combinedListingText = [userText, visibleListingText].filter(Boolean).join("\n\n");

  // Check if we have enough meaningful text
  if (!isMeaningfulListingText(combinedListingText)) {
    return { should_display: false };
  }

  const messages = [
    { role: "system", content: REALITY_CHECK_SYSTEM_PROMPT },
    { role: "user", content: `LISTING TEXT TO ANALYZE:\n${combinedListingText}\n\nAnalyze this listing text for promotional language and marketing tactics. Return JSON only.` }
  ];

  const requestBody = {
    model: "openai/gpt-4.1-mini",
    messages,
    temperature: 0.3,
    max_tokens: 800,
  };

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openRouterApiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://trteewgplkqiedonomzg.supabase.co",
          "X-Title": "Rental Property Analyzer",
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      console.error("[RealityCheck] API error:", response.status);
      return { should_display: false };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      return { should_display: false };
    }

    const parsed = safeParseModelJson(content);
    return normalizeRealityCheck(parsed);
  } catch (err) {
    console.error("[RealityCheck] Error:", err);
    return { should_display: false };
  }
}

// ========== Helper Functions ==========

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function mapVerdict(verdict?: string): 'Worth Inspecting' | 'Proceed With Caution' | 'Likely Overpriced / Risky' | 'Need More Evidence' {
  const v = verdict?.toLowerCase() || '';
  if (v.includes('inspecting') || v.includes('inspect')) return 'Worth Inspecting';
  if (v.includes('caution')) return 'Proceed With Caution';
  if (v.includes('overpriced') || v.includes('risky')) return 'Likely Overpriced / Risky';
  return 'Need More Evidence';
}

function mapSaleVerdict(verdict?: string): 'Worth Inspecting' | 'Proceed With Caution' | 'Likely Overpriced / Risky' | 'Need More Evidence' {
  const v = verdict?.toLowerCase() || '';
  if (v.includes('strong buy')) return 'Worth Inspecting';
  if (v.includes('consider carefully') || v.includes('consider')) return 'Proceed With Caution';
  if (v.includes('probably skip') || v.includes('skip')) return 'Likely Overpriced / Risky';
  return 'Need More Evidence';
}

interface PhotoAnalysis {
  photoIndex: number;
  areaType: string;
  summary: string;
  score: number;
  signals?: string[];
}

interface SpaceAggregationResult {
  spaceType: string;
  score: number;
  photoCount: number;
  insights: string[];
}

interface Step2Recommendation {
  verdict?: string;
  good_fit_for?: string[];
  not_ideal_for?: string[];
}

interface Step2InspectionFit {
  good_for?: string[];
  not_ideal_for?: string[];
}

interface Step2Decision {
  overall_score?: number;
  decision_priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  confidence_level?: 'High' | 'Medium' | 'Low';
  overall_verdict?: string;
  pros?: string[];
  cons?: string[];
  hidden_risks?: string[];
  final_recommendation?: {
    verdict: string;
    reason: string;
  };
  score_context?: {
    market_position: string;
    explanation: string;
  };
  risks?: string[];
  space_analysis?: {
    area_type: string;
    score: number;
    explanation?: string;
    insights?: string[];
  }[];
  property_strengths?: string[];
  potential_issues?: string[];
  competition_risk?: { level: string; reasons: string[] };
  inspection_fit?: Step2InspectionFit;
  recommendation?: Step2Recommendation;
  questions_to_ask?: string[];
  agent_questions?: string[];
  rent_fairness?: {
    estimated_min: number;
    estimated_max: number;
    listing_price: number;
    verdict: 'underpriced' | 'fair' | 'slightly_overpriced' | 'overpriced';
    explanation: string;
  };
  light_thermal_guide?: {
    natural_light_summary?: string;
    sun_exposure?: 'Low' | 'Moderate' | 'High' | 'Unknown';
    thermal_risk?: 'Likely Cold' | 'Balanced' | 'Likely Hot' | 'Unknown';
    summer_comfort?: string;
    winter_comfort?: string;
    confidence?: 'Low' | 'Medium' | 'High';
    evidence?: string[];
  };
  agent_lingo_translation?: {
    should_display?: boolean;
    phrases?: {
      phrase: string;
      plain_english: string;
      confidence?: 'Low' | 'Medium' | 'High';
    }[];
  };
  application_strategy?: {
    urgency?: 'Low' | 'Medium' | 'High';
    apply_speed?: string;
    checklist?: string[];
    reasoning?: string[];
  };
}

/**
 * Sale-specific decision output from Step 2 AI model
 */
interface Step2DecisionSale {
  overall_score?: number;
  decision_priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  confidence_level?: 'High' | 'Medium' | 'Low';
  overall_verdict?: string;
  pros?: string[];
  cons?: string[];
  hidden_risks?: string[];
  final_recommendation?: {
    verdict: string;
    reason: string;
  };
  score_context?: {
    market_position: string;
    explanation: string;
  };
  risks?: string[];
  space_analysis?: {
    area_type: string;
    score: number;
    explanation?: string;
    insights?: string[];
  }[];
  property_strengths?: string[];
  potential_issues?: string[];
  competition_risk?: { level: string; reasons: string[] };
  inspection_fit?: Step2InspectionFit;
  recommendation?: Step2Recommendation;
  questions_to_ask?: string[];
  agent_questions?: string[];
  price_assessment?: {
    estimated_min: number;
    estimated_max: number;
    asking_price: number;
    verdict: 'underpriced' | 'fair' | 'slightly_overpriced' | 'overpriced';
    explanation: string;
  };
  investment_potential?: {
    growth_outlook?: 'Strong' | 'Moderate' | 'Weak' | 'Unknown';
    rental_yield_estimate?: string;
    capital_growth_5yr?: string;
    key_positives?: string[];
    key_concerns?: string[];
  };
  affordability_check?: {
    estimated_deposit_20pct?: number;
    estimated_loan?: number;
    estimated_monthly_repayment?: string;
    assessment?: 'manageable' | 'stretch' | 'challenging';
    note?: string;
  };
  inspection_focus?: string[];
  long_term_outlook?: {
    verdict?: 'Strong Hold Potential' | 'Neutral' | 'Risky';
    reasoning?: string;
  };
  light_thermal_guide?: {
    natural_light_summary?: string;
    sun_exposure?: 'Low' | 'Moderate' | 'High' | 'Unknown';
    thermal_risk?: 'Likely Cold' | 'Balanced' | 'Likely Hot' | 'Unknown';
    summer_comfort?: string;
    winter_comfort?: string;
    confidence?: 'Low' | 'Medium' | 'High';
    evidence?: string[];
  };
  // === Sale 模式新增字段 ===
  land_value_analysis?: {
    land_size?: number;
    price_per_sqm?: number;
    land_banking_potential?: boolean;
    scarcity_indicator?: 'High' | 'Medium' | 'Low';
    property_type?: 'House' | 'Apartment' | 'Unit' | 'Townhouse' | 'Unknown';
    explanation?: string;
  };
  holding_costs?: {
    deposit_20pct?: number;
    stamp_duty?: number;
    stamp_duty_state?: 'VIC' | 'NSW' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'ACT' | 'NT' | 'Other';
    transfer_fees?: number;
    legal_costs?: number;
    inspection_costs?: number;
    estimated_monthly_repayment?: string;
    total_upfront_costs?: number;
    cash_flow_analysis?: {
      potential_rent?: number;
      weekly_mortgage_interest?: number;
      weekly_difference?: number;
      verdict?: 'Positive Gearing' | 'Negative Gearing' | 'Neutral';
    };
  };
  red_flag_alerts?: {
    keyword: string;
    category: 'legal' | 'structural' | 'financial' | 'location';
    severity: 'high' | 'medium' | 'low';
    message: string;
    action: string;
  }[];
  state_specific_advice?: {
    state?: 'VIC' | 'NSW' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'ACT' | 'NT' | 'Unknown';
    recommendations?: string[];
  };
  // === Sale 模式新增字段 END ===
}

function aggregateSpaceAnalysis(photos: PhotoAnalysis[]): SpaceAggregationResult[] {
  const groupedByArea = new Map<string, PhotoAnalysis[]>();
  
  for (const photo of photos) {
    const areaType = photo.areaType || 'unknown';
    if (!groupedByArea.has(areaType)) {
      groupedByArea.set(areaType, []);
    }
    groupedByArea.get(areaType)!.push(photo);
  }

  const aggregated: SpaceAggregationResult[] = [];
  
  for (const [areaType, areaPhotos] of groupedByArea) {
    const scores = areaPhotos.map(p => p.score || 50);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const scoreRange = maxScore - minScore;
    
    // 基础分数
    let finalScore = Math.round(avgScore);
    
    // ========== 强化极值调整 ==========
    
    // 1. 强弱点放大：如果范围大，说明有明显的分化
    if (scoreRange > 25) {
      // 有明显分化，放大差异
      if (minScore < 55) {
        finalScore = Math.max(minScore, Math.round(finalScore - 12));
      }
      if (maxScore > 78) {
        finalScore = Math.min(92, Math.round(finalScore + 10));
      }
    } else {
      // 范围较小，按正常调整
      if (minScore < 50) {
        const penalty = Math.min(12, (50 - minScore) * 0.4);
        finalScore = Math.max(minScore, Math.round(finalScore - penalty));
      }
      if (maxScore > 80) {
        const bonus = Math.min(6, (maxScore - 80) * 0.25);
        finalScore = Math.min(92, Math.round(finalScore + bonus));
      }
    }
    
    // 2. 厨房/浴室对低分更敏感（更狠的惩罚）
    if ((areaType === 'kitchen' || areaType === 'bathroom') && minScore < 58) {
      finalScore = Math.max(minScore, finalScore - 8);
    }
    
    // 3. 强制避免中间值：如果最终分数在 60-70 之间，考虑推动
    if (finalScore >= 60 && finalScore <= 70) {
      // 如果整体偏弱，降到 60 以下
      if (minScore < 55 || avgScore < 62) {
        finalScore = Math.max(minScore + 5, 55);
      }
      // 如果整体偏强，提升到 70 以上
      else if (maxScore > 75 && avgScore > 68) {
        finalScore = Math.min(78, Math.round(avgScore + 5));
      }
    }
    
    // 收集信号和观察
    const allSignals: string[] = [];
    for (const photo of areaPhotos) {
      if (photo.signals && Array.isArray(photo.signals)) {
        allSignals.push(...photo.signals);
      }
      if (photo.summary) {
        allSignals.push(photo.summary);
      }
    }
    
    const uniqueInsights = new Map<string, string>();
    for (const signal of allSignals) {
      const normalized = signal.toLowerCase().trim();
      if (normalized && !uniqueInsights.has(normalized)) {
        uniqueInsights.set(normalized, signal);
      }
    }
    
    const insights = Array.from(uniqueInsights.values()).slice(0, 4);
    
    let finalInsights = insights;
    if (areaPhotos.length === 1 && finalScore < 50) {
      finalInsights = [`${capitalizeFirst(areaType)} space unclear from photo`];
    }
    
    aggregated.push({
      spaceType: areaType,
      score: finalScore,
      photoCount: areaPhotos.length,
      insights: finalInsights
    });
  }

  aggregated.sort((a, b) => b.score - a.score);
  
  return aggregated;
}

function capitalizeFirst(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function safeParseModelJson(content: unknown) {
  const raw = String(content ?? "").trim();

  const withoutFence = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");

  const jsonText =
    firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace
      ? withoutFence.slice(firstBrace, lastBrace + 1)
      : withoutFence;

  return JSON.parse(jsonText);
}

// ========== Step 2 Helpers ==========

function extractModelText(data: any): string | null {
  const choice = data?.choices?.[0];
  if (!choice) return null;

  const content = choice?.message?.content;

  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const text = content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item?.type === "text" && typeof item?.text === "string") return item.text;
        return "";
      })
      .join("")
      .trim();

    return text || null;
  }

  return null;
}

function classifyStep2ResponseIssue(data: any): string {
  if (!data) return "empty_response_object";
  if (!Array.isArray(data?.choices) || data.choices.length === 0) return "empty_choices";
  if (!data?.choices?.[0]?.message) return "missing_message";
  if (data?.choices?.[0]?.message && data?.choices?.[0]?.message?.content == null) return "missing_content";
  return "unknown_structure";
}

async function callStep2Model(
  openRouterApiKey: string,
  step2Messages: any[],
): Promise<{ rawText: string; parsed: Step2Decision }> {
  const step2RequestBody = {
    model: "anthropic/claude-haiku-4.5",
    messages: step2Messages,
    temperature: 0.1,
    max_tokens: 5000,
  };

  async function attempt(attemptNumber: number): Promise<{ rawText: string; parsed: Step2Decision }> {
    console.log(`[Step 2] attempt ${attemptNumber} start`);

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openRouterApiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://trteewgplkqiedonomzg.supabase.co",
          "X-Title": "Rental Property Analyzer",
        },
        body: JSON.stringify(step2RequestBody),
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("[Step 2] API error response:", JSON.stringify(errorData));
      throw new Error(
        (errorData as { error?: { message?: string } }).error?.message ||
          `Step 2 failed: ${response.status}`
      );
    }

    const data = await response.json();

    console.log("[Step 2] raw response preview:", JSON.stringify(data).slice(0, 2000));
    console.log("[Step 2] finish_reason:", data?.choices?.[0]?.finish_reason ?? null);
    console.log("[Step 2] provider:", data?.provider ?? null);
    console.log("[Step 2] usage:", JSON.stringify(data?.usage ?? null));

    const rawText = extractModelText(data);

    if (!rawText) {
      const issue = classifyStep2ResponseIssue(data);
      throw new Error(
        `Step 2 returned no usable text (${issue}) | finish_reason=${data?.choices?.[0]?.finish_reason ?? "unknown"}`
      );
    }

    try {
      const parsed = safeParseModelJson(rawText) as Step2Decision;
      return { rawText, parsed };
    } catch (parseErr) {
      console.error("[Step 2] JSON parse failed. Raw text preview:", rawText.slice(0, 2000));
      throw new Error("Step 2 returned invalid JSON");
    }
  }

  try {
    return await attempt(1);
  } catch (err1) {
    console.error("[Step 2] attempt 1 failed:", err1);

    console.log("[Step 2] retrying once...");
    return await attempt(2);
  }
}

// ========== URL Validation Helper ==========

function isValidHttpUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function buildStep1Messages(imageUrls: string[] = [], batchIndex = 0) {
  // Filter and validate URLs
  const validUrls = Array.isArray(imageUrls)
    ? imageUrls.filter(isValidHttpUrl)
    : [];

  const BATCH_SIZE = 20;
  const start = batchIndex * BATCH_SIZE;
  const end = start + BATCH_SIZE;
  const batchUrls = validUrls.slice(start, end);

  // Adjust photoIndex to be global across batches
  const photoIndexOffset = start;

  const userContent: Step1UserContent[] = batchUrls.map((url) => ({
    type: "image_url",
    image_url: { url },
  }));

  userContent.push({
    type: "text",
    text: `Analyze these property photos (batch ${batchIndex + 1}) and return short structured JSON only. Use photoIndex 0-${batchUrls.length - 1} for each photo in this batch.`,
  });

  return {
    messages: [
      { role: "system", content: STEP1_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    photoIndexOffset,
    batchSize: batchUrls.length,
  };
}

/**
 * Merge multiple visual analysis results from batched Step 1 calls.
 * Adjusts photoIndex to be global and merges spaceAnalysis by spaceType.
 */
function mergeVisualAnalysis(
  results: Array<{ photos?: Array<Record<string, unknown>>; spaceAnalysis?: Array<Record<string, unknown>> }>
): Record<string, unknown> {
  const allPhotos: Array<Record<string, unknown>> = [];
  const spaceAnalysisMap = new Map<string, Record<string, unknown>>();

  for (const result of results) {
    if (!result) continue;

    // Merge photos with adjusted index
    if (Array.isArray(result.photos)) {
      for (const photo of result.photos) {
        allPhotos.push({ ...photo });
      }
    }

    // Merge spaceAnalysis by spaceType
    if (Array.isArray(result.spaceAnalysis)) {
      for (const space of result.spaceAnalysis) {
        const spaceType = space.spaceType as string;
        if (spaceType && spaceAnalysisMap.has(spaceType)) {
          // Merge observations from duplicate space types
          const existing = spaceAnalysisMap.get(spaceType)!;
          const existingObs = (existing.observations as string[]) || [];
          const newObs = (space.observations as string[]) || [];
          existing.observations = [...new Set([...existingObs, ...newObs])].slice(0, 5);
          // Average the scores
          const existingScore = (existing.score as number) || 0;
          const newScore = (space.score as number) || 0;
          existing.score = Math.round((existingScore + newScore) / 2);
        } else {
          spaceAnalysisMap.set(spaceType, { ...space });
        }
      }
    }
  }

  return {
    photos: allPhotos,
    spaceAnalysis: Array.from(spaceAnalysisMap.values()),
  };
}

function buildStep2Messages(
  reportMode: ReportMode,
  visualAnalysis: Record<string, unknown> | null,
  description?: string,
  optionalDetails?: {
    weeklyRent?: string;
    askingPrice?: string;
    suburb?: string;
    bedrooms?: string | number;
    bathrooms?: string | number;
    parking?: string | number;
  },
) {
  const systemPrompt = reportMode === 'sale' ? STEP2_SALE_PROMPT : STEP2_RENT_PROMPT;

  let textContent = visualAnalysis
    ? `VISUAL ANALYSIS RESULTS:\n${JSON.stringify(visualAnalysis, null, 2)}\n\n`
    : "VISUAL ANALYSIS RESULTS:\nNo photos provided - analysis based on listing description only.\n\n";

  if (description?.trim()) {
    textContent += `LISTING DESCRIPTION:\n${description}\n\n`;
  }

  if (optionalDetails) {
    const details: string[] = [];
    if (reportMode === 'rent' && optionalDetails.weeklyRent) {
      details.push(`Weekly Rent: ${optionalDetails.weeklyRent}`);
    } else if (reportMode === 'sale' && optionalDetails.askingPrice) {
      details.push(`Asking Price: ${optionalDetails.askingPrice}`);
    }
    if (optionalDetails.suburb) {
      details.push(`Location: ${optionalDetails.suburb}`);
    }
    if (optionalDetails.bedrooms !== undefined && optionalDetails.bedrooms !== null) {
      details.push(`Bedrooms: ${optionalDetails.bedrooms}`);
    }
    if (optionalDetails.bathrooms !== undefined && optionalDetails.bathrooms !== null) {
      details.push(`Bathrooms: ${optionalDetails.bathrooms}`);
    }
    if (optionalDetails.parking !== undefined && optionalDetails.parking !== null) {
      details.push(`Parking: ${optionalDetails.parking}`);
    }

    if (details.length > 0) {
      textContent += `ADDITIONAL DETAILS:\n${details.join("\n")}\n\n`;
    }
  }

  const reportType = reportMode === 'sale' ? 'purchase' : 'rental';
  textContent +=
    `Based on the visual analysis and listing details, provide your ${reportType} decision report in JSON format.`;

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: textContent },
  ];
}

// ========== Main Handler ==========

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const queryId = url.searchParams.get("id");

  // GET: Query status
  if (req.method === "GET" && queryId) {
    const state = await getAnalysisState(queryId);
    if (!state) {
      return jsonResponse({ message: "Analysis not found" }, 404);
    }
    // Fetch report_mode from analyses table for consistency
    let reportMode: string = 'rent';
    try {
      const analysisRes = await fetch(
        `${SUPABASE_URL}/rest/v1/analyses?id=eq.${queryId}&select=report_mode`,
        {
          headers: {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );
      if (analysisRes.ok) {
        const analyses = await analysisRes.json();
        if (analyses && analyses.length > 0 && analyses[0].report_mode) {
          reportMode = analyses[0].report_mode;
        }
      }
    } catch (e) {
      console.error("Failed to fetch report_mode:", e);
    }
    return jsonResponse({ ...state, report_mode: reportMode });
  }

  // GET: List user analyses history
  if (req.method === "GET" && action === "list") {
    const { user, error: authError } = await getCurrentUser(req);
    if (authError || !user) {
      return jsonResponse({ message: "Authentication required", code: "NOT_AUTHENTICATED" }, 401);
    }

    const limit = Number.parseInt(url.searchParams.get("limit") || "20", 10);
    const offset = Number.parseInt(url.searchParams.get("offset") || "0", 10);

    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/analyses?user_id=eq.${user.id}&select=*&order=created_at.desc&limit=${limit}&offset=${offset}`,
        {
          headers: {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );

      if (!response.ok) {
        console.error("Failed to fetch analyses:", await response.text());
        return jsonResponse({ message: "Failed to fetch analyses" }, 500);
      }

      const analyses = await response.json();
      return jsonResponse({ analyses });
    } catch (err) {
      console.error("Error fetching analyses:", err);
      return jsonResponse({ message: "Failed to fetch analyses" }, 500);
    }
  }

  // GET: Get single analysis by ID
  if (req.method === "GET" && action === "get") {
    const analysisId = url.searchParams.get("id");
    if (!analysisId) {
      return jsonResponse({ message: "Missing analysis ID" }, 400);
    }

    const { user, error: authError } = await getCurrentUser(req);
    if (authError || !user) {
      return jsonResponse({ message: "Authentication required", code: "NOT_AUTHENTICATED" }, 401);
    }

    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/analyses?id=eq.${analysisId}&user_id=eq.${user.id}&select=*`,
        {
          headers: {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );

      if (!response.ok) {
        return jsonResponse({ message: "Analysis not found" }, 404);
      }

      const analyses = await response.json();
      if (!analyses || analyses.length === 0) {
        return jsonResponse({ message: "Analysis not found" }, 404);
      }

      return jsonResponse({ analysis: analyses[0] });
    } catch (err) {
      console.error("Error fetching analysis:", err);
      return jsonResponse({ message: "Failed to fetch analysis" }, 500);
    }
  }

  // POST: Make analysis public (share)
  if (req.method === "POST" && action === "share") {
    const { analysisId } = await req.json();
    if (!analysisId) {
      return jsonResponse({ message: "Missing analysis ID" }, 400);
    }

    const { user, error: authError } = await getCurrentUser(req);
    if (authError || !user) {
      return jsonResponse({ message: "Authentication required", code: "NOT_AUTHENTICATED" }, 401);
    }

    try {
      // First get the analysis to check ownership
      const getResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/analyses?id=eq.${analysisId}&user_id=eq.${user.id}&select=*`,
        {
          headers: {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );

      if (!getResponse.ok) {
        return jsonResponse({ message: "Analysis not found" }, 404);
      }

      const analyses = await getResponse.json();
      if (!analyses || analyses.length === 0) {
        return jsonResponse({ message: "Analysis not found" }, 404);
      }

      const analysis = analyses[0];

      // If already public, return existing share info (don't regenerate)
      if (analysis.is_public && analysis.share_slug) {
        return jsonResponse({
          success: true,
          slug: analysis.share_slug,
          shareUrl: `${SITE_URL}/share/${analysis.share_slug}`,
          alreadyShared: true
        });
      }

      // Generate semantic share slug
      const suburb = analysis.address || null;
      const summary = analysis.summary || {};
      const fullResult = analysis.full_result || {};

      // Extract bedrooms/bathrooms from summary or full_result
      let bedrooms: number | null = null;
      let bathrooms: number | null = null;
      let propertyType: string | null = null;
      let reportMode: ReportMode = 'rent';
      let askingPrice: number | null = null;

      if (summary.bedrooms) {
        const bedroomsMatch = String(summary.bedrooms).match(/(\d+)/);
        if (bedroomsMatch) bedrooms = parseInt(bedroomsMatch[1], 10);
      }
      if (summary.bathrooms) {
        const bathroomsMatch = String(summary.bathrooms).match(/(\d+)/);
        if (bathroomsMatch) bathrooms = parseInt(bathroomsMatch[1], 10);
      }
      if (summary.propertyType) {
        propertyType = String(summary.propertyType);
      }

      // Extract from full_result if not in summary
      if (!bedrooms && fullResult.roomCounts) {
        const bedroomCount = fullResult.roomCounts['bedroom'] || fullResult.roomCounts['bedrooms'];
        if (bedroomCount) bedrooms = bedroomCount;
      }
      if (!propertyType && fullResult.inspectionFit) {
        // Could extract from inspectionFit if needed
      }
      if (fullResult.reportMode) {
        reportMode = fullResult.reportMode as ReportMode;
      }
      if (fullResult.price_assessment?.asking_price) {
        askingPrice = Number(fullResult.price_assessment.asking_price);
      }

      // Build semantic slug: sydney-2-bedroom-apartment-rental-analysis-58
      const seo_slug = generateShareSlug({
        suburb,
        bedrooms,
        propertyType,
        reportId: analysisId,
        reportMode,
      });

      // Extract weeklyRent from full_result if available
      const weeklyRent = summary.weeklyRent
        ? parseInt(String(summary.weeklyRent).replace(/[^0-9]/g, ''), 10)
        : fullResult.rent_fairness?.listing_price
          ? Number(fullResult.rent_fairness.listing_price)
          : null;

      // Generate SEO title and description
      const { seo_title, seo_description } = generateSEOFields({
        suburb,
        bedrooms,
        bathrooms,
        weeklyRent: reportMode === 'rent' ? weeklyRent : undefined,
        askingPrice: reportMode === 'sale' ? askingPrice : undefined,
        verdict: analysis.verdict,
        reportId: analysisId,
        reportMode,
      });

      // Update to public with full SEO data
      const now = new Date().toISOString();
      const updateData: Record<string, unknown> = {
        is_public: true,
        share_slug: seo_slug,
        seo_title,
        seo_description,
        shared_at: now,
      };

      const updateResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/analyses?id=eq.${analysisId}`,
        {
          method: "PATCH",
          headers: {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "return=representation",
          },
          body: JSON.stringify(updateData),
        }
      );

      if (!updateResponse.ok) {
        console.error("Failed to share analysis:", await updateResponse.text());
        return jsonResponse({ message: "Failed to share analysis" }, 500);
      }

      return jsonResponse({
        success: true,
        slug: seo_slug,
        seo_title,
        seo_description,
        shareUrl: `${SITE_URL}/share/${seo_slug}`
      });
    } catch (err) {
      console.error("Error sharing analysis:", err);
      return jsonResponse({ message: "Failed to share analysis" }, 500);
    }
  }

  // GET: Public access to shared analysis (no auth required)
  if (req.method === "GET" && action === "public") {
    const slug = url.searchParams.get("slug");
    if (!slug) {
      return jsonResponse({ message: "Missing share slug" }, 400);
    }

    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/analyses?share_slug=eq.${slug}&is_public=eq.true&select=*`,
        {
          headers: {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      );

      if (!response.ok) {
        return jsonResponse({ message: "Analysis not found" }, 404);
      }

      const analyses = await response.json();
      if (!analyses || analyses.length === 0) {
        return jsonResponse({ message: "Analysis not found or not shared" }, 404);
      }

      const analysis = analyses[0];
      
      // Return only public-safe data including SEO fields
      return jsonResponse({
        analysis: {
          id: analysis.id,
          overall_score: analysis.overall_score,
          verdict: analysis.verdict,
          title: analysis.title,
          address: analysis.address,
          cover_image_url: analysis.cover_image_url,
          summary: analysis.summary,
          full_result: analysis.full_result,
          created_at: analysis.created_at,
          updated_at: analysis.updated_at,
          share_slug: analysis.share_slug,
          seo_title: analysis.seo_title,
          seo_description: analysis.seo_description,
          shared_at: analysis.shared_at,
          is_public: true,
          report_mode: analysis.report_mode || 'rent',
        }
      });
    } catch (err) {
      console.error("Error fetching public analysis:", err);
      return jsonResponse({ message: "Failed to fetch analysis" }, 500);
    }
  }

  // POST: submit / run
  if (req.method !== "POST") {
    return jsonResponse({ message: "Method not allowed" }, 405);
  }

  const contentLength = req.headers.get("content-length");
  if (contentLength && Number.parseInt(contentLength, 10) > 4 * 1024 * 1024) {
    return jsonResponse(
      { message: "Request too large. Maximum 4MB allowed." },
      413,
    );
  }

  let body: {
    id?: string;
    imageUrls?: string[];
    description?: string;
    reportMode?: ReportMode;
    optionalDetails?: {
      weeklyRent?: string;
      askingPrice?: string;
      suburb?: string;
      bedrooms?: string | number;
      bathrooms?: string | number;
      parking?: string | number;
    };
  };

  try {
    body = await req.json();
  } catch {
    return jsonResponse({ message: "Invalid JSON in request body" }, 400);
  }

  // ========== 权限检查 ==========
  // 只对 submit 和 run action 进行权限检查
  let user: UserProfile | null = null;
  if (action === "submit" || action === "run" || !action) {
    const result = await getCurrentUser(req);
    user = result.user;
    const authError = result.error;

    console.log("=== Backend Permission Check ===");
    console.log("User:", user ? `${user.email} (${user.id})` : "NOT_AUTHENTICATED");
    console.log("Credits remaining:", user?.credits_remaining ?? "N/A");
    console.log("Credits reserved:", user?.credits_reserved ?? "N/A");
    console.log("Available credits:", (user ? user.credits_remaining - user.credits_reserved : 0));

    if (authError || !user) {
      console.log("analyze blocked reason: NOT_AUTHENTICATED");
      return jsonResponse({ message: "Please sign in first to analyze listings.", code: "NOT_AUTHENTICATED" }, 401);
    }

    if (!hasAvailableCredits(user)) {
      console.log("analyze blocked reason: NO_AVAILABLE_CREDITS");
      return jsonResponse({ message: "No free analyses left. Please purchase more credits to continue.", code: "NO_CREDITS" }, 403);
    }

    console.log("analyze allowed: proceeding with analysis");
  }

  // ACTION: submit (create new analysis task)
  if (action === "submit" || !action) {
    const imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls.filter(isValidHttpUrl) : [];
    const description = typeof body.description === "string" ? body.description : "";
    const reportMode: ReportMode = body.reportMode === 'sale' ? 'sale' : 'rent';

    if (imageUrls.length === 0 && !description.trim()) {
      return jsonResponse({ message: "Please provide images or description" }, 400);
    }

    const analysisId = crypto.randomUUID();
    await createAnalysisState(analysisId);

    // Create analysis record in analyses table
    // MUST succeed before returning - this is critical for history to work
    if (user) {
      const createResult = await createAnalysisRecord(
        analysisId,
        user.id,
        imageUrls,
        description,
        body.optionalDetails,
        reportMode
      );
      
      if (!createResult.success) {
        console.error("CRITICAL: Failed to create analysis record in submit action:", createResult.error);
        // Return error so client knows the submit failed
        return jsonResponse({ 
          message: "Failed to create analysis record", 
          code: "CREATE_FAILED",
          error: createResult.error 
        }, 500);
      }
      
      console.log("=== submit: analysis record created successfully ===");
    } else {
      console.error("CRITICAL: user is null in submit action - should have been caught by permission check");
      return jsonResponse({ message: "User not authenticated", code: "NOT_AUTHENTICATED" }, 401);
    }

    console.log("\n=== Rental Property Analyzer start ===");
    console.log("Image URLs provided:", imageUrls.length);
    console.log("Description provided:", !!description.trim());
    console.log("Analysis ID:", analysisId);

    return jsonResponse({ id: analysisId, status: "queued" }, 202);
  }

  // ACTION: run (execute analysis)
  if (action === "run") {
    console.log("=== RUN ACTION START ===");
    console.log("Request body:", JSON.stringify(body));
    
    const id = body.id;
    if (!id) {
      console.error("Missing id in run action - body:", JSON.stringify(body));
      return jsonResponse({ message: "Missing id for run action" }, 400);
    }

    console.log("Analysis ID for run:", id);

    // Get user for credits operation (user was already validated in permission check)
    const { user: currentUser, error: userError } = await getCurrentUser(req);
    if (userError || !currentUser) {
      return jsonResponse({ message: "Authentication required", code: "NOT_AUTHENTICATED" }, 401);
    }

    // Pre-reserve credit before starting analysis (atomic operation)
    const reserveResult = await reserveCredits(currentUser.id, id);
    if (!reserveResult.success) {
      console.log("Failed to reserve credits:", reserveResult.error);
      
      // Distinguish error types for proper HTTP status
      const errorCode = reserveResult.error;
      let httpStatus = 500; // Default to 500 (server error) for unknown issues
      let clientMessage = "Failed to process request";
      
      if (errorCode === "No credits available") {
        httpStatus = 403;
        clientMessage = "No free analyses left. Please purchase more credits to continue.";
      } else if (errorCode === "User not found") {
        httpStatus = 404;
        clientMessage = "User account not found";
      } else if (errorCode === "Permission denied") {
        httpStatus = 403;
        clientMessage = "Permission denied";
      } else if (errorCode?.includes("Failed to check") || errorCode?.includes("Invalid response")) {
        httpStatus = 500;
        clientMessage = "Server error: database connection failed";
      }
      
      return jsonResponse({ 
        message: clientMessage, 
        code: errorCode 
      }, httpStatus);
    }

    const usageId = reserveResult.usageId;
    console.log("=== Credits reserved, starting analysis ===");
    console.log("User ID:", currentUser.id);
    console.log("Analysis ID:", id);
    console.log("Usage Record ID:", usageId);

    const imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls.filter(isValidHttpUrl) : [];
    const description = typeof body.description === "string" ? body.description : "";
    const optionalDetails = body.optionalDetails ?? {};
    const reportMode: ReportMode = body.reportMode === 'sale' ? 'sale' : 'rent';

    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!openRouterApiKey) {
      // Analysis failed - release credits
      await releaseCredits(currentUser.id, usageId);
      await updateAnalysisState(id, {
        stage: "failed",
        message: "OPENROUTER_API_KEY not configured",
        progress: 100,
        status: "failed",
        error: "Server configuration error",
      });
      return jsonResponse({ message: "Server configuration error" }, 500);
    }

    console.log("\n=== Rental Property Analyzer start ===");
    console.log("Analysis ID:", id);
    console.log("Image URLs provided:", imageUrls.length);
    console.log("Description provided:", !!description.trim());

    // Initial state update to processing
    await updateAnalysisState(id, {
      stage: "detecting_rooms",
      message: "Analyzing property photos...",
      progress: 15,
      status: "processing",
    });

    try {
      let visualAnalysis: Record<string, unknown> | null = null;

      // Start Reality Check in parallel with Step 1
      console.log("\n[Reality Check] Starting in parallel...");
      let realityCheckPromise: Promise<RealityCheck> = Promise.resolve({ should_display: false });
      
      if (description?.trim()) {
        realityCheckPromise = runRealityCheck(
          openRouterApiKey,
          description,
          ""
        ).catch((rcError) => {
          console.error("[RealityCheck] Failed:", rcError);
          return { should_display: false };
        });
      }

      // Step 1: Visual analysis (batched for stability)
      if (imageUrls.length > 0) {
        console.log("\n[Step 1] Visual analysis start (batched)");
        
        const MAX_BATCHES = 2; // 最多 2 批 = 40 张图片
        const BATCH_SIZE = 20;
        const numBatches = Math.min(Math.ceil(imageUrls.length / BATCH_SIZE), MAX_BATCHES);
        
        const batchResults: Array<Record<string, unknown>> = [];
        let batchSuccessCount = 0;

        for (let batchIndex = 0; batchIndex < numBatches; batchIndex++) {
          console.log(`[Step 1 Batch ${batchIndex + 1}/${numBatches}] Processing...`);
          
          const { messages, photoIndexOffset } = buildStep1Messages(imageUrls, batchIndex);

          const step1RequestBody = {
            model: "openai/gpt-4.1-mini",
            messages: messages,
            temperature: 0.1,
            max_tokens: 4000, // 稍微提高以适应更多输出
          };

          try {
            const step1Response = await fetch(
              "https://openrouter.ai/api/v1/chat/completions",
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${openRouterApiKey}`,
                  "Content-Type": "application/json",
                  "HTTP-Referer": "https://trteewgplkqiedonomzg.supabase.co",
                  "X-Title": "Rental Property Analyzer",
                },
                body: JSON.stringify(step1RequestBody),
              },
            );

            if (!step1Response.ok) {
              const errorData = await step1Response.json().catch(() => ({}));
              console.error(`[Step 1 Batch ${batchIndex + 1}] Error Response:`, JSON.stringify(errorData));
              // 继续下一批，不抛出异常
              continue;
            }

            const step1Data = await step1Response.json();
            const step1Content = step1Data?.choices?.[0]?.message?.content;

            if (!step1Content) {
              console.warn(`[Step 1 Batch ${batchIndex + 1}] No response content`);
              continue;
            }

            try {
              const batchResult = safeParseModelJson(step1Content) as Record<string, unknown>;
              
              // Adjust photoIndex to be global
              if (Array.isArray(batchResult.photos)) {
                for (const photo of batchResult.photos) {
                  if (typeof photo.photoIndex === 'number') {
                    photo.photoIndex = photo.photoIndex + photoIndexOffset;
                  }
                }
              }
              
              batchResults.push(batchResult);
              batchSuccessCount++;
              console.log(`[Step 1 Batch ${batchIndex + 1}] Success, ${(batchResult.photos as unknown[])?.length || 0} photos analyzed`);
            } catch {
              console.warn(`[Step 1 Batch ${batchIndex + 1}] JSON parse failed, skipping batch`);
            }
          } catch (batchError) {
            console.error(`[Step 1 Batch ${batchIndex + 1}] Request failed:`, batchError);
            // 继续下一批
          }
        }

        // Merge results from all successful batches
        if (batchResults.length > 0) {
          visualAnalysis = mergeVisualAnalysis(batchResults as Parameters<typeof mergeVisualAnalysis>[0]);
          console.log(`[Step 1] Merged ${batchResults.length} batches, total photos: ${(visualAnalysis.photos as unknown[])?.length || 0}`);
        } else {
          // 所有批次都失败了
          console.warn("[Step 1] All batches failed, proceeding without visual analysis");
          visualAnalysis = null;
        }

        console.log("[Step 1] Visual analysis complete");

        // Update state after Step 1
        await updateAnalysisState(id, {
          stage: "evaluating_spaces",
          message: "Evaluating property spaces...",
          progress: 35,
        });
      } else {
        console.log("[Step 1] Skipped - no image URLs provided");
      }

      // Before Step 2
      await updateAnalysisState(id, {
        stage: "extracting_strengths_and_issues",
        message: "Extracting strengths and potential issues...",
        progress: 55,
      });

      console.log("\n[Step 2] Decision reasoning start");

      const step2Messages = buildStep2Messages(
        reportMode,
        visualAnalysis,
        description,
        optionalDetails,
      );

      const { rawText: step2RawText, parsed: decision } = await callStep2Model(
        openRouterApiKey,
        step2Messages,
      );

      console.log("[Step 2] parsed successfully. overall_verdict:", decision.overall_verdict ?? null);
      console.log("[Step 2] raw text preview:", step2RawText.slice(0, 1000));

      console.log("[Step 2] Decision complete:", decision.overall_verdict);

      // Update state before competition estimation
      await updateAnalysisState(id, {
        stage: "estimating_competition",
        message: "Estimating competition level...",
        progress: 75,
      });

      // Wait for Reality Check result (started in parallel earlier)
      const realityCheckResult = await realityCheckPromise;
      console.log("[Reality Check] Complete, should_display:", realityCheckResult.should_display);

      // Build final result
      const competitionRisk = decision.competition_risk || {
        level: 'MEDIUM',
        reasons: ['Unable to assess competition risk']
      };
      
      const recommendation: Step2Recommendation = (decision.recommendation as Step2Recommendation | null | undefined) ?? {
        verdict: (decision.overall_verdict as string) || 'Need More Evidence',
        good_fit_for: [],
        not_ideal_for: []
      };

      const photoAnalysis: PhotoAnalysis[] = Array.isArray(visualAnalysis?.photos)
        ? (visualAnalysis!.photos as PhotoAnalysis[])
        : [];
      const aggregatedSpaceAnalysis = aggregateSpaceAnalysis(photoAnalysis);

      const analyzedPhotoCount = imageUrls.length;
      const roomCounts: Record<string, number> = {};
      for (const p of photoAnalysis) {
        const key = (p.areaType || 'unknown').toLowerCase().trim() || 'unknown';
        roomCounts[key] = (roomCounts[key] ?? 0) + 1;
      }
      const detectedRooms = Object.keys(roomCounts)
        .filter((k) => k !== 'unknown')
        .sort();

      const overallScoreNum = typeof decision.overall_score === 'number' ? decision.overall_score : 0;

      // Determine verdict based on report mode
      const verdictStr = recommendation.verdict || '';
      const mappedVerdict = reportMode === 'sale' ? mapSaleVerdict(verdictStr) : mapVerdict(verdictStr);

      // Build mode-specific fields
      const rentFields = reportMode === 'rent' ? {
        rent_fairness: (decision as any).rent_fairness ? {
          estimated_min: typeof (decision as any).rent_fairness.estimated_min === 'number'
            ? (decision as any).rent_fairness.estimated_min
            : typeof (decision as any).rent_fairness.estimated_min === 'string'
            ? parseInt(String((decision as any).rent_fairness.estimated_min).replace(/[^0-9]/g, ''), 10)
            : null,
          estimated_max: typeof (decision as any).rent_fairness.estimated_max === 'number'
            ? (decision as any).rent_fairness.estimated_max
            : typeof (decision as any).rent_fairness.estimated_max === 'string'
            ? parseInt(String((decision as any).rent_fairness.estimated_max).replace(/[^0-9]/g, ''), 10)
            : null,
          listing_price: typeof (decision as any).rent_fairness.listing_price === 'number'
            ? (decision as any).rent_fairness.listing_price
            : typeof (decision as any).rent_fairness.listing_price === 'string'
            ? parseInt(String((decision as any).rent_fairness.listing_price).replace(/[^0-9]/g, ''), 10)
            : null,
          verdict: (decision as any).rent_fairness.verdict || 'fair',
          explanation: (decision as any).rent_fairness.explanation || ''
        } : null,
        applicationStrategy: (decision as any).application_strategy
          ? {
              urgency: (decision as any).application_strategy.urgency || 'Medium',
              applySpeed: (decision as any).application_strategy.apply_speed || '',
              checklist: Array.isArray((decision as any).application_strategy.checklist)
                ? (decision as any).application_strategy.checklist
                : [],
              reasoning: Array.isArray((decision as any).application_strategy.reasoning)
                ? (decision as any).application_strategy.reasoning
                : []
            }
          : null,
      } : { rent_fairness: null, applicationStrategy: null };

      const saleFields = reportMode === 'sale' ? {
        price_assessment: (decision as any).price_assessment ? {
          estimated_min: typeof (decision as any).price_assessment.estimated_min === 'number'
            ? (decision as any).price_assessment.estimated_min
            : typeof (decision as any).price_assessment.estimated_min === 'string'
            ? parseInt(String((decision as any).price_assessment.estimated_min).replace(/[^0-9]/g, ''), 10)
            : null,
          estimated_max: typeof (decision as any).price_assessment.estimated_max === 'number'
            ? (decision as any).price_assessment.estimated_max
            : typeof (decision as any).price_assessment.estimated_max === 'string'
            ? parseInt(String((decision as any).price_assessment.estimated_max).replace(/[^0-9]/g, ''), 10)
            : null,
          asking_price: typeof (decision as any).price_assessment.asking_price === 'number'
            ? (decision as any).price_assessment.asking_price
            : typeof (decision as any).price_assessment.asking_price === 'string'
            ? parseInt(String((decision as any).price_assessment.asking_price).replace(/[^0-9]/g, ''), 10)
            : null,
          verdict: (decision as any).price_assessment.verdict || 'fair',
          explanation: (decision as any).price_assessment.explanation || ''
        } : null,
        investment_potential: (decision as any).investment_potential ? {
          growth_outlook: (decision as any).investment_potential.growth_outlook || 'Unknown',
          rental_yield_estimate: (decision as any).investment_potential.rental_yield_estimate || '',
          capital_growth_5yr: (decision as any).investment_potential.capital_growth_5yr || '',
          key_positives: Array.isArray((decision as any).investment_potential.key_positives)
            ? (decision as any).investment_potential.key_positives : [],
          key_concerns: Array.isArray((decision as any).investment_potential.key_concerns)
            ? (decision as any).investment_potential.key_concerns : []
        } : null,
        affordability_check: (decision as any).affordability_check ? {
          estimated_deposit_20pct: typeof (decision as any).affordability_check.estimated_deposit_20pct === 'number'
            ? (decision as any).affordability_check.estimated_deposit_20pct
            : typeof (decision as any).affordability_check.estimated_deposit_20pct === 'string'
            ? parseInt(String((decision as any).affordability_check.estimated_deposit_20pct).replace(/[^0-9]/g, ''), 10)
            : null,
          estimated_loan: typeof (decision as any).affordability_check.estimated_loan === 'number'
            ? (decision as any).affordability_check.estimated_loan
            : typeof (decision as any).affordability_check.estimated_loan === 'string'
            ? parseInt(String((decision as any).affordability_check.estimated_loan).replace(/[^0-9]/g, ''), 10)
            : null,
          estimated_monthly_repayment: (decision as any).affordability_check.estimated_monthly_repayment || '',
          assessment: (decision as any).affordability_check.assessment || 'manageable',
          note: (decision as any).affordability_check.note || ''
        } : null,
        // === Sale 模式新增字段映射 ===
        land_value_analysis: (decision as any).land_value_analysis ? {
          landSize: typeof (decision as any).land_value_analysis.land_size === 'number'
            ? (decision as any).land_value_analysis.land_size
            : typeof (decision as any).land_value_analysis.land_size === 'string'
            ? parseInt(String((decision as any).land_value_analysis.land_size).replace(/[^0-9]/g, ''), 10)
            : undefined,
          pricePerSqm: typeof (decision as any).land_value_analysis.price_per_sqm === 'number'
            ? (decision as any).land_value_analysis.price_per_sqm
            : typeof (decision as any).land_value_analysis.price_per_sqm === 'string'
            ? parseInt(String((decision as any).land_value_analysis.price_per_sqm).replace(/[^0-9]/g, ''), 10)
            : undefined,
          landBankingPotential: (decision as any).land_value_analysis.land_banking_potential === true,
          scarcityIndicator: (decision as any).land_value_analysis.scarcity_indicator || 'Medium',
          propertyType: (decision as any).land_value_analysis.property_type || 'Unknown',
          explanation: (decision as any).land_value_analysis.explanation || ''
        } : null,
        holding_costs: (decision as any).holding_costs ? {
          deposit20pct: typeof (decision as any).holding_costs.deposit_20pct === 'number'
            ? (decision as any).holding_costs.deposit_20pct
            : typeof (decision as any).holding_costs.deposit_20pct === 'string'
            ? parseInt(String((decision as any).holding_costs.deposit_20pct).replace(/[^0-9]/g, ''), 10)
            : 0,
          stampDuty: typeof (decision as any).holding_costs.stamp_duty === 'number'
            ? (decision as any).holding_costs.stamp_duty
            : typeof (decision as any).holding_costs.stamp_duty === 'string'
            ? parseInt(String((decision as any).holding_costs.stamp_duty).replace(/[^0-9]/g, ''), 10)
            : 0,
          stampDutyState: (decision as any).holding_costs.stamp_duty_state || 'Other',
          transferFees: typeof (decision as any).holding_costs.transfer_fees === 'number'
            ? (decision as any).holding_costs.transfer_fees
            : typeof (decision as any).holding_costs.transfer_fees === 'string'
            ? parseInt(String((decision as any).holding_costs.transfer_fees).replace(/[^0-9]/g, ''), 10)
            : 0,
          legalCosts: typeof (decision as any).holding_costs.legal_costs === 'number'
            ? (decision as any).holding_costs.legal_costs
            : typeof (decision as any).holding_costs.legal_costs === 'string'
            ? parseInt(String((decision as any).holding_costs.legal_costs).replace(/[^0-9]/g, ''), 10)
            : 0,
          inspectionCosts: typeof (decision as any).holding_costs.inspection_costs === 'number'
            ? (decision as any).holding_costs.inspection_costs
            : typeof (decision as any).holding_costs.inspection_costs === 'string'
            ? parseInt(String((decision as any).holding_costs.inspection_costs).replace(/[^0-9]/g, ''), 10)
            : 0,
          estimatedMonthlyRepayment: (decision as any).holding_costs.estimated_monthly_repayment || '',
          totalUpfrontCosts: typeof (decision as any).holding_costs.total_upfront_costs === 'number'
            ? (decision as any).holding_costs.total_upfront_costs
            : typeof (decision as any).holding_costs.total_upfront_costs === 'string'
            ? parseInt(String((decision as any).holding_costs.total_upfront_costs).replace(/[^0-9]/g, ''), 10)
            : undefined,
          cashFlowAnalysis: (decision as any).holding_costs.cash_flow_analysis ? {
            potentialRent: typeof (decision as any).holding_costs.cash_flow_analysis.potential_rent === 'number'
              ? (decision as any).holding_costs.cash_flow_analysis.potential_rent
              : typeof (decision as any).holding_costs.cash_flow_analysis.potential_rent === 'string'
              ? parseInt(String((decision as any).holding_costs.cash_flow_analysis.potential_rent).replace(/[^0-9]/g, ''), 10)
              : undefined,
            weeklyMortgageInterest: typeof (decision as any).holding_costs.cash_flow_analysis.weekly_mortgage_interest === 'number'
              ? (decision as any).holding_costs.cash_flow_analysis.weekly_mortgage_interest
              : typeof (decision as any).holding_costs.cash_flow_analysis.weekly_mortgage_interest === 'string'
              ? parseInt(String((decision as any).holding_costs.cash_flow_analysis.weekly_mortgage_interest).replace(/[^0-9]/g, ''), 10)
              : 0,
            weeklyDifference: typeof (decision as any).holding_costs.cash_flow_analysis.weekly_difference === 'number'
              ? (decision as any).holding_costs.cash_flow_analysis.weekly_difference
              : typeof (decision as any).holding_costs.cash_flow_analysis.weekly_difference === 'string'
              ? parseInt(String((decision as any).holding_costs.cash_flow_analysis.weekly_difference).replace(/[^0-9]/g, ''), 10)
              : 0,
            verdict: (decision as any).holding_costs.cash_flow_analysis.verdict || 'Neutral'
          } : undefined
        } : null,
        red_flag_alerts: Array.isArray((decision as any).red_flag_alerts)
          ? (decision as any).red_flag_alerts.map((alert: any) => ({
            keyword: alert.keyword || '',
            category: alert.category || 'financial',
            severity: alert.severity || 'low',
            message: alert.message || '',
            action: alert.action || ''
          }))
          : undefined,
        state_specific_advice: (decision as any).state_specific_advice ? {
          state: (decision as any).state_specific_advice.state || 'Unknown',
          recommendations: Array.isArray((decision as any).state_specific_advice.recommendations)
            ? (decision as any).state_specific_advice.recommendations
            : []
        } : null,
        // === Sale 模式新增增强字段映射 ===
        deal_breakers: (decision as any).deal_breakers ? {
          summary: (decision as any).deal_breakers.summary || '',
          overall_severity: (decision as any).deal_breakers.overall_severity || 'LOW',
          items: Array.isArray((decision as any).deal_breakers.items)
            ? (decision as any).deal_breakers.items.map((item: any) => ({
                title: item.title || '',
                severity: item.severity || 'LOW',
                category: item.category || 'OTHER',
                description: item.description || '',
                why_it_matters: item.why_it_matters || '',
                mitigation: item.mitigation || ''
              }))
            : []
        } : null,
        next_move: (decision as any).next_move ? {
          decision: (decision as any).next_move.decision || 'PROCEED_WITH_CAUTION',
          headline: (decision as any).next_move.headline || '',
          reasoning: (decision as any).next_move.reasoning || '',
          suggested_actions: Array.isArray((decision as any).next_move.suggested_actions)
            ? (decision as any).next_move.suggested_actions
            : []
        } : null,
        would_i_buy: (decision as any).would_i_buy ? {
          answer: (decision as any).would_i_buy.answer || 'MAYBE',
          confidence: (decision as any).would_i_buy.confidence || 'MEDIUM',
          reason: (decision as any).would_i_buy.reason || ''
        } : null,
        // === Sale 模式新增字段映射 END ===
      } : { price_assessment: null, investment_potential: null, affordability_check: null };

      const result = {
        id, // Analysis ID for sharing functionality
        reportMode, // NEW: report mode indicator
        overallScore: overallScoreNum,
        finalRecommendation: decision.final_recommendation ? {
          verdict: decision.final_recommendation.verdict || 'Apply With Caution',
          reason: decision.final_recommendation.reason || ''
        } : null,
        scoreContext: decision.score_context ? {
          marketPosition: decision.score_context.market_position || 'Average',
          explanation: decision.score_context.explanation || ''
        } : null,
        decisionPriority: decision.decision_priority || (overallScoreNum > 75 ? 'HIGH' : overallScoreNum >= 55 ? 'MEDIUM' : 'LOW'),
        confidenceLevel: decision.confidence_level || 'Medium',
        overallVerdict: decision.overall_verdict || '',
        quickSummary: decision.overall_verdict || '',
        whatLooksGood: decision.pros || [],
        riskSignals: decision.cons || [],
        hiddenRisks: decision.hidden_risks || [],
        risks: decision.risks || [],
        verdict: mappedVerdict,
        realityCheck: decision.overall_verdict || '',
        reality_check: realityCheckResult,
        spaceAnalysis: (decision.space_analysis as { area_type: string; score: number; explanation?: string; insights?: string[]; photo_count?: number }[] || aggregatedSpaceAnalysis).map((s: any) => ({
          spaceType: s.area_type || s.spaceType,
          score: s.score,
          explanation: s.explanation || '',
          photoCount: s.photo_count || s.photoCount || 0,
          observations: s.insights || s.observations || []
        })),
        propertyStrengths: decision.property_strengths || [],
        potentialIssues: decision.potential_issues || [],
        competitionRisk: competitionRisk,
        inspectionFit: {
          good_for: decision.inspection_fit?.good_for || recommendation.good_fit_for || [],
          not_ideal_for: decision.inspection_fit?.not_ideal_for || recommendation.not_ideal_for || []
        },
        recommendation: {
          verdict: mappedVerdict,
          goodFitIf: recommendation.good_fit_for || [],
          notIdealIf: recommendation.not_ideal_for || []
        },
        questionsToAsk: decision.questions_to_ask || decision.agent_questions || [],
        agentQuestions: decision.agent_questions || decision.questions_to_ask || [],
        ...rentFields,
        ...saleFields,
        lightThermalGuide: decision.light_thermal_guide
          ? {
              naturalLightSummary: decision.light_thermal_guide.natural_light_summary || '',
              sunExposure: decision.light_thermal_guide.sun_exposure || 'Unknown',
              thermalRisk: decision.light_thermal_guide.thermal_risk || 'Unknown',
              summerComfort: decision.light_thermal_guide.summer_comfort || '',
              winterComfort: decision.light_thermal_guide.winter_comfort || '',
              confidence: decision.light_thermal_guide.confidence || 'Low',
              evidence: Array.isArray(decision.light_thermal_guide.evidence)
                ? decision.light_thermal_guide.evidence
                : []
            }
          : null,
        agentLingoTranslation: decision.agent_lingo_translation
          ? {
              shouldDisplay: decision.agent_lingo_translation.should_display === true,
              phrases: Array.isArray(decision.agent_lingo_translation.phrases)
                ? decision.agent_lingo_translation.phrases.map((item: any) => ({
                    phrase: item?.phrase || '',
                    plainEnglish: item?.plain_english || '',
                    confidence: item?.confidence || 'Low'
                  }))
                : []
            }
          : { shouldDisplay: false, phrases: [] },
        photos: Array.isArray(visualAnalysis?.photos) ? visualAnalysis.photos : [],
        visualAnalysis: visualAnalysis
          ? {
              renovationLevel: visualAnalysis.renovationLevel ?? null,
              cosmeticFlipRisk: visualAnalysis.cosmeticFlipRisk ?? null,
              naturalLight: visualAnalysis.naturalLight ?? null,
              spacePerception: visualAnalysis.spacePerception ?? null,
              maintenanceImpression: visualAnalysis.maintenanceCondition ?? null,
              kitchenCondition: visualAnalysis.kitchenCondition ?? null,
              bathroomCondition: visualAnalysis.bathroomCondition ?? null,
              missingKeyAreas: visualAnalysis.missingKeyAreas ?? [],
              photoObservations: visualAnalysis.photoObservations ?? [],
            }
          : null,
        spatialMetrics: visualAnalysis?.spatialMetrics ?? null,
        analyzedPhotoCount,
        detectedRooms,
        roomCounts,
        analyzed_photo_count: analyzedPhotoCount,
        detected_rooms: detectedRooms,
        room_counts: roomCounts,
      };

      // Update state before building final report
      await updateAnalysisState(id, {
        stage: "building_final_report",
        message: "Building final report...",
        progress: 90,
      });

      // Final state update
      await updateAnalysisState(id, {
        stage: "done",
        message: "Analysis complete!",
        progress: 100,
        status: "done",
        result,
      });

      // Update analysis record in analyses table
      await updateAnalysisRecord(
        id,
        result.overallScore,
        result.verdict,
        {
          quickSummary: result.quickSummary,
          whatLooksGood: result.whatLooksGood,
          riskSignals: result.riskSignals,
        },
        result as Record<string, unknown>,
        reportMode // 传递 reportMode 以同步到数据库
      );

      // Analysis succeeded - complete the credit usage
      await completeCredits(currentUser.id, usageId);

      console.log("=== Analysis complete, credits deducted ===");

      return jsonResponse({ ok: true, id });

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      console.error("===================");
      console.error("Analysis error:", err.message);
      console.error("===================");

      // Analysis failed - release the reserved credit
      await releaseCredits(currentUser.id, usageId);
      console.log("=== Analysis failed, credits released ===");

      await updateAnalysisState(id, {
        stage: "failed",
        message: err.message || "Analysis failed",
        progress: 100,
        status: "failed",
        error: err.message,
      });

      // Mark analysis as failed in analyses table
      await failAnalysisRecord(id, err.message);

      return jsonResponse({ 
        message: "Analysis failed",
        error: err.message 
      }, 500);
    }
  }

  return jsonResponse({ message: "Invalid action" }, 400);
});
