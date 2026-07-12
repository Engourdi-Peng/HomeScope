// Supabase Edge Function - Paddle Webhook
// 处理 Paddle 支付回调，验证支付后增加用户积分

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get(name: string): string | undefined;
  };
};

// ========== 内联共享配置 ==========
const BASE_CREDITS: Record<string, number> = {
  starter: 5,
  standard: 12,
  pro: 35,
};

const AFFILIATE_BONUS: Record<string, number> = {
  starter: 0,
  standard: 1,
  pro: 2,
};

const PLAN_PRICES: Record<string, number> = {
  starter: 6.99,
  standard: 15.99,
  pro: 39.99,
};

function isValidPlanKey(key: string): key is keyof typeof BASE_CREDITS {
  return key in BASE_CREDITS;
}

function getPriceIdEnvKey(planKey: string, isSandbox: boolean): string {
  const suffix = isSandbox ? "SANDBOX" : "LIVE";
  return `PRICE_${planKey.toUpperCase()}_${suffix}`;
}
// ========== 配置结束 ==========

// ========== 环境变量配置 ==========
const PADDLE_ENV = Deno.env.get("PADDLE_ENV") || "sandbox";
const IS_SANDBOX = PADDLE_ENV === "sandbox";

// Paddle webhook 不需要 API key，但环境判断必须正确
if (PADDLE_ENV === "production" && !Deno.env.get("PADDLE_WEBHOOK_SECRET")) {
  console.warn("⚠️ PADDLE_ENV=production but PADDLE_WEBHOOK_SECRET is not set. Webhooks will be rejected.");
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://trteewgplkqiedonomzg.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Paddle webhook 签名验证
const PADDLE_WEBHOOK_SECRET = Deno.env.get("PADDLE_WEBHOOK_SECRET") || "";
// 仅在本地开发时跳过签名验证
const SKIP_SIGNATURE_VERIFICATION = Deno.env.get("PADDLE_SKIP_SIGNATURE") === "true" || PADDLE_ENV === "local";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, passthrough",
};

// 校验 Paddle price_id 格式
function isValidPaddlePriceId(v: string | undefined): v is string {
  if (!v) return false;
  return /^pri_[a-zA-Z0-9]{26}$/.test(v.trim());
}

// 获取并校验环境变量中的 price_id
function getValidatedPriceId(envKey: string): string {
  const value = Deno.env.get(envKey)?.trim();
  if (!value || !isValidPaddlePriceId(value)) {
    throw new Error(`Invalid or missing Paddle price id: ${envKey}. Expected format: pri_ followed by 26 alphanumeric characters`);
  }
  return value;
}

// 获取环境隔离的 price_id
function getEnvironmentPriceId(planKey: string): string {
  const envKey = getPriceIdEnvKey(planKey, IS_SANDBOX);
  return getValidatedPriceId(envKey);
}

// 有效的 price_id 集合（用于 webhook 验证）
const VALID_PRICE_IDS = new Set([
  getEnvironmentPriceId("starter"),
  getEnvironmentPriceId("standard"),
  getEnvironmentPriceId("pro"),
]);

/**
 * 验证 Paddle webhook 签名（HMAC-SHA256）
 * Paddle Billing 新版使用 notification secret 和 HMAC-SHA256 签名
 * 格式: Paddle-Signature: ts=...;h1=...
 */
async function verifyPaddleSignature(req: Request, rawBody: string): Promise<boolean> {
  // 沙盒模式下跳过验证（仅用于开发测试）
  if (SKIP_SIGNATURE_VERIFICATION) {
    console.log("⚠️ PADDLE_SKIP_SIGNATURE=true, skipping signature verification (sandbox mode)");
    return true;
  }

  // 生产环境必须验证签名
  if (!PADDLE_WEBHOOK_SECRET) {
    console.error("❌ PADDLE_WEBHOOK_SECRET not configured - rejecting webhook");
    return false;
  }

  // Paddle-Signature header (Paddle 使用大写 S)
  const signatureHeader = req.headers.get("Paddle-Signature") || req.headers.get("paddle-signature");
  if (!signatureHeader) {
    console.error("Missing Paddle-Signature header");
    return false;
  }

  // 解析签名格式：ts=...;h1=...（分号分隔，h1 不是 v1）
  const parts: Record<string, string> = {};
  const segments = signatureHeader.split(";");
  for (const segment of segments) {
    const idx = segment.indexOf("=");
    if (idx === -1) continue;
    const key = segment.substring(0, idx).trim();
    const value = segment.substring(idx + 1).trim();
    parts[key] = value;
  }

  const timestamp = parts["ts"];
  const expectedSignature = parts["h1"];

  if (!timestamp || !expectedSignature) {
    console.error(`Invalid signature format: ${signatureHeader}`);
    return false;
  }

  // 构造签名消息：timestamp:rawBody（冒号，不是点号）
  const signedPayload = `${timestamp}:${rawBody}`;

  // 计算 HMAC-SHA256
  const encoder = new TextEncoder();
  const keyData = encoder.encode(PADDLE_WEBHOOK_SECRET);
  const msgData = encoder.encode(signedPayload);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
  const signatureArray = new Uint8Array(signatureBuffer);
  const computedSignature = Array.from(signatureArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // constant-time 比较防止时序攻击
  if (computedSignature.length !== expectedSignature.length) {
    console.error("Signature mismatch (length)");
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < computedSignature.length; i++) {
    mismatch |= computedSignature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
  }

  if (mismatch !== 0) {
    console.error("Signature mismatch");
    return false;
  }

  // 可选：验证时间戳防止重放攻击（5分钟窗口）
  const eventTimestamp = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  const tolerance = 300;

  if (Math.abs(now - eventTimestamp) > tolerance) {
    console.error(`Timestamp outside tolerance: event=${eventTimestamp}, now=${now}`);
    return false;
  }

  console.log("✓ Paddle webhook signature verified");
  return true;
}

/**
 * 从 Paddle 事件中提取产品对应的积分数量
 */
function getCreditsForProduct(planKey: string): number {
  return BASE_CREDITS[planKey] || 0;
}

/**
 * 验证 webhook 中的 price_id 是否有效
 */
function validatePriceId(priceId: string | undefined): void {
  if (!priceId) {
    throw new Error("Missing price_id in transaction items");
  }
  if (!VALID_PRICE_IDS.has(priceId)) {
    console.error("Invalid price_id:", priceId);
    console.error("Valid price_ids:", Array.from(VALID_PRICE_IDS));
    throw new Error(`Invalid price_id: ${priceId}. This webhook may be from a different environment.`);
  }
}

/**
 * 统一的支付处理函数，同时处理 transaction.paid 和 transaction.completed
 * 两者共用同一个加积分逻辑，幂等通过 paddle_transaction_id 保证
 */
async function handlePaymentTransaction(
  transaction: { id: string; custom_data?: Record<string, unknown>; items?: Array<{ price?: { id?: string } }> },
  eventType: string
): Promise<{ userId: string; planKey: string; credits: number; affiliateId?: string; affiliateCode?: string }> {
  const transactionId = transaction.id;
  const userId = transaction.custom_data?.user_id as string | undefined;
  const planKey = (transaction.custom_data?.plan_key || transaction.custom_data?.product) as string | undefined;
  const affiliateId = transaction.custom_data?.affiliate_id as string | undefined;
  const affiliateCode = transaction.custom_data?.affiliate_code as string | undefined;

  console.log(`[paddle-webhook] environment: ${IS_SANDBOX ? "sandbox" : "production"}`);
  console.log(`[paddle-webhook] ${eventType}:`, { transactionId, userId, planKey, affiliateId, affiliateCode });

  if (!userId) {
    throw new Error("Missing user_id in transaction custom_data");
  }

  if (!planKey) {
    throw new Error("Missing plan_key in transaction custom_data");
  }

  if (!isValidPlanKey(planKey)) {
    throw new Error(`Invalid plan_key: ${planKey}`);
  }

  // 验证 price_id（防止跨环境 webhook）
  if (transaction.items && transaction.items.length > 0) {
    const priceId = transaction.items[0]?.price?.id;
    validatePriceId(priceId);
  }

  const credits = getCreditsForProduct(planKey);
  if (credits === 0) {
    throw new Error(`Invalid product: ${planKey}`);
  }

  // 如果有邀请码，额外增加积分作为奖励
  if (affiliateCode) {
    const bonus = AFFILIATE_BONUS[planKey] || 0;
    if (bonus > 0) {
      console.log(`[paddle-webhook] Affiliate bonus: +${bonus} credits for plan ${planKey}`);
      const totalCredits = credits + bonus;
      await processPaymentWithRPC(transactionId, userId, planKey, totalCredits, affiliateId, affiliateCode);
      return { userId, planKey, credits: totalCredits, affiliateId, affiliateCode };
    }
  }

  const result = await processPaymentWithRPC(transactionId, userId, planKey, credits, affiliateId, affiliateCode);

  if (!result.success) {
    throw new Error(result.error || "RPC call failed");
  }

  if (result.alreadyProcessed) {
    console.log(`Transaction already processed (idempotent): ${transactionId}`);
  } else {
    console.log(`Payment processed: user=${userId}, credits=${credits}, affiliate=${affiliateCode || 'none'}`);
  }

  return { userId, planKey, credits, affiliateId, affiliateCode };
}

/**
 * 调用 RPC 处理支付完成事件（原子操作：增加积分 + 创建佣金记录）
 */
async function processPaymentWithRPC(
  transactionId: string,
  userId: string,
  planKey: string,
  credits: number,
  affiliateId?: string,
  affiliateCode?: string
): Promise<{ success: boolean; alreadyProcessed?: boolean; error?: string }> {
  try {
    const body: Record<string, unknown> = {
      p_transaction_id: transactionId,
      p_user_id: userId,
      p_plan_key: planKey,
      p_credits: credits,
    };

    if (affiliateId) {
      body.p_affiliate_id = affiliateId;
    }
    if (affiliateCode) {
      body.p_affiliate_code = affiliateCode;
    }

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/process_paddle_completed_transaction`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("RPC call failed:", errorText);
      return { success: false, error: errorText };
    }

    const result = await response.json();
    console.log("RPC result:", result);

    return {
      success: result.success === true,
      alreadyProcessed: result.already_processed === true,
    };
  } catch (err) {
    console.error("RPC call error:", err);
    return { success: false, error: String(err) };
  }
}

Deno.serve(async (req) => {
  // 处理 CORS 预检请求
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // 只允许 POST 请求
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // 获取请求体
    const bodyText = await req.text();

    // 验证 Paddle 签名
    if (!(await verifyPaddleSignature(req, bodyText))) {
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const event = JSON.parse(bodyText);
    console.log("Received Paddle event:", event.event_type);

    // 处理不同的事件类型
    switch (event.event_type) {
      case "transaction.paid":
      case "transaction.completed": {
        try {
          await handlePaymentTransaction(event.data, event.event_type);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // 幂等检查：如果已经处理过，静默返回 200
          if (msg.includes("already processed") || msg.includes("already_processed")) {
            console.log("Transaction already processed, returning 200:", event.data.id);
            return new Response(
              JSON.stringify({ success: true, alreadyProcessed: true }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          console.error(`Failed to process ${event.event_type}:`, msg);
          return new Response(
            JSON.stringify({ error: msg }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "transaction.canceled":
      case "transaction.failed": {
        const transaction = event.data;
        const transactionId = transaction.id;
        console.log(`Payment ${event.event_type}: transaction=${transactionId}`);
        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        console.log("Unhandled event type:", event.event_type);
        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
