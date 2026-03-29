// Supabase Edge Function - Rental Property Analyzer
// Deploy with: supabase functions deploy analyze

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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
 * Format: suburb-bedroom-propertyType-rental-analysis-{id}
 */
function generateShareSlug(input: {
  suburb?: string | null;
  bedrooms?: number | null;
  propertyType?: string | null;
  reportId: string;
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

  parts.push('rental-analysis');
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
  verdict?: string | null;
  reportId: string;
}): { seo_title: string; seo_description: string } {
  const { suburb, bedrooms, bathrooms, weeklyRent, verdict } = input;

  // Generate SEO title
  let seo_title: string;
  if (suburb && bedrooms) {
    seo_title = `Is this rental worth it in ${suburb}? ${bedrooms} bedroom analysis`;
  } else if (bedrooms) {
    seo_title = `Is this rental worth it? ${bedrooms} bedroom analysis`;
  } else {
    seo_title = `Rental property analysis | HomeScope`;
  }

  // Generate SEO description
  let seo_description: string;
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

async function getAnalysisState(id: string): Promise<AnalysisState | null> {
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
  optionalDetails?: Record<string, unknown>
): Promise<void> {
  // Extract title/address from description if available
  const title = extractTitleFromDescription(description);
  const address = optionalDetails?.suburb as string | undefined;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/analyses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({
      id,
      user_id: userId,
      status: "pending",
      title: title || null,
      address: address || null,
      cover_image_url: pickCoverImage(imageUrls) || null,
      summary: null,
      full_result: null,
    }),
  });

  if (!response.ok) {
    console.error("Failed to create analysis record:", await response.text());
  } else {
    console.log("Analysis record created:", id);
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
  fullResult: Record<string, unknown>
): Promise<void> {
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
      updated_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    console.error("Failed to update analysis record:", await response.text());
  } else {
    console.log("Analysis record updated:", id);
  }
}

/**
 * Mark analysis record as failed
 */
async function failAnalysisRecord(id: string, error: string): Promise<void> {
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

  if (!response.ok) {
    console.error("Failed to mark analysis as failed:", await response.text());
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
SCORE GUIDELINES (be conservative, avoid inflated scores):
================================

SCORE INTERPRETATION:
- 90-100: Exceptional, modern, well-maintained
- 80-89: Strong, above average, clearly appealing
- 70-79: Solid, functional, generally good
- 60-69: Average, acceptable, mixed evidence
- 50-59: Below average, noticeable weaknesses
- 0-49: Poor, outdated, unclear, problematic

MOST ORDINARY RENTAL PHOTOS SHOULD SCORE 55-75.
Do not give high scores unless evidence is clearly strong.

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
- Follow scoring guidelines - be conservative, most rentals score 55-75`;

const STEP2_SYSTEM_PROMPT = `You are an Australian renter helping another renter decide whether a listing is worth their time.

Think of it like getting advice from a mate who's rented for years and knows the traps. Be practical, direct, and honest. You're not trying to sell the place — you're trying to help someone avoid a bad decision.

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
    const totalScore = areaPhotos.reduce((sum, p) => sum + (p.score || 50), 0);
    const avgScore = Math.round(totalScore / areaPhotos.length);
    
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
    if (areaPhotos.length === 1 && avgScore < 50) {
      finalInsights = [`${capitalizeFirst(areaType)} space unclear from photo`];
    }
    
    aggregated.push({
      spaceType: areaType,
      score: avgScore,
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

function buildStep1Messages(imageUrls: string[] = []) {
  // Filter and validate URLs
  const validUrls = Array.isArray(imageUrls)
    ? imageUrls.filter(isValidHttpUrl)
    : [];

  const userContent: Step1UserContent[] = validUrls.slice(0, 20).map((url) => ({
    type: "image_url",
    image_url: { url },
  }));

  userContent.push({
    type: "text",
    text: "Analyze these property photos and return short structured JSON only.",
  });

  return [
    { role: "system", content: STEP1_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}

function buildStep2Messages(
  visualAnalysis: Record<string, unknown> | null,
  description?: string,
  optionalDetails?: {
    weeklyRent?: string;
    suburb?: string;
    bedrooms?: string | number;
    bathrooms?: string | number;
    parking?: string | number;
  },
) {
  let textContent = visualAnalysis
    ? `VISUAL ANALYSIS RESULTS:\n${JSON.stringify(visualAnalysis, null, 2)}\n\n`
    : "VISUAL ANALYSIS RESULTS:\nNo photos provided - analysis based on listing description only.\n\n";

  if (description?.trim()) {
    textContent += `LISTING DESCRIPTION:\n${description}\n\n`;
  }

  if (optionalDetails) {
    const details: string[] = [];
    if (optionalDetails.weeklyRent) {
      details.push(`Weekly Rent: ${optionalDetails.weeklyRent}`);
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

  textContent +=
    "Based on the visual analysis and listing details, provide your rental decision report in JSON format.";

  return [
    { role: "system", content: STEP2_SYSTEM_PROMPT },
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
    return jsonResponse(state);
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

      // Build semantic slug: sydney-2-bedroom-apartment-rental-analysis-58
      const seo_slug = generateShareSlug({
        suburb,
        bedrooms,
        propertyType,
        reportId: analysisId
      });

      // Generate SEO title and description
      const { seo_title, seo_description } = generateSEOFields({
        suburb,
        bedrooms,
        bathrooms,
        weeklyRent: summary.weeklyRent ? parseInt(String(summary.weeklyRent).replace(/[^0-9]/g, ''), 10) : null,
        verdict: analysis.verdict,
        reportId: analysisId
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
    optionalDetails?: {
      weeklyRent?: string;
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

    if (imageUrls.length === 0 && !description.trim()) {
      return jsonResponse({ message: "Please provide images or description" }, 400);
    }

    const analysisId = crypto.randomUUID();
    await createAnalysisState(analysisId);

    // Create analysis record in analyses table
    if (user) {
      await createAnalysisRecord(
        analysisId,
        user.id,
        imageUrls,
        description,
        body.optionalDetails
      );
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

      // Step 1: Visual analysis
      if (imageUrls.length > 0) {
        console.log("\n[Step 1] Visual analysis start");
        
        const step1Messages = buildStep1Messages(imageUrls);

        const step1RequestBody = {
          model: "openai/gpt-4.1-mini",
          messages: step1Messages,
          temperature: 0.1,
          max_tokens: 3000,
        };

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
          console.error("Step 1 Error Response:", JSON.stringify(errorData));
          throw new Error(
            (errorData as { error?: { message?: string } }).error?.message ||
              `Step 1 failed: ${step1Response.status}`,
          );
        }

        const step1Data = await step1Response.json();
        const step1Content = step1Data?.choices?.[0]?.message?.content;

        if (!step1Content) {
          throw new Error("No response from Step 1");
        }

        try {
          visualAnalysis = safeParseModelJson(step1Content);
        } catch {
          throw new Error("Invalid JSON from Step 1 - failed to parse model response");
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
      const result = {
        id, // Analysis ID for sharing functionality
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
        verdict: mapVerdict(recommendation.verdict),
        realityCheck: decision.overall_verdict || '',
        reality_check: realityCheckResult,
        spaceAnalysis: (decision.space_analysis as { area_type: string; score: number; explanation?: string; insights?: string[] }[] || aggregatedSpaceAnalysis).map((s: any) => ({
          spaceType: s.area_type || s.spaceType,
          score: s.score,
          explanation: s.explanation || '',
          photoCount: s.photoCount || 0,
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
          verdict: mapVerdict(recommendation.verdict),
          goodFitIf: recommendation.good_fit_for || [],
          notIdealIf: recommendation.not_ideal_for || []
        },
        questionsToAsk: decision.questions_to_ask || decision.agent_questions || [],
        agentQuestions: decision.agent_questions || decision.questions_to_ask || [],
        rent_fairness: decision.rent_fairness ? {
          estimated_min: typeof decision.rent_fairness.estimated_min === 'number' ? decision.rent_fairness.estimated_min : null,
          estimated_max: typeof decision.rent_fairness.estimated_max === 'number' ? decision.rent_fairness.estimated_max : null,
          listing_price: typeof decision.rent_fairness.listing_price === 'number' ? decision.rent_fairness.listing_price : null,
          verdict: decision.rent_fairness.verdict || 'fair',
          explanation: decision.rent_fairness.explanation || ''
        } : null,
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
        applicationStrategy: decision.application_strategy
          ? {
              urgency: decision.application_strategy.urgency || 'Medium',
              applySpeed: decision.application_strategy.apply_speed || '',
              checklist: Array.isArray(decision.application_strategy.checklist)
                ? decision.application_strategy.checklist
                : [],
              reasoning: Array.isArray(decision.application_strategy.reasoning)
                ? decision.application_strategy.reasoning
                : []
            }
          : null,
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
        result as Record<string, unknown>
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
