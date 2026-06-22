// Supabase Edge Function - Vendors Webhook
// 处理 Paddle 支付回调：发放 credits + 生成佣金
// - 只处理 transaction.completed 事件
// - 使用数据库 RPC 实现原子化的幂等处理
// - 如果 custom_data 包含 affiliate 信息，生成佣金记录

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get(name: string): string | undefined;
  };
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://trteewgplkqiedonomzg.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Paddle Webhook 配置
const PADDLE_WEBHOOK_SECRET = Deno.env.get("PADDLE_WEBHOOK_SECRET") || "";

// Timestamp tolerance for replay attack prevention (5 minutes)
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-signature, paddle-signature",
};

// 产品映射 - credits 数量（与 create-order 一致）
const PRODUCT_CREDITS: Record<string, number> = {
  starter: 3,
  standard: 10,
  pro: 40,
};

/**
 * Converts a Uint8Array to a hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * 验证 Paddle Webhook 签名
 * 使用 raw body 和 HMAC-SHA256 验证
 * 参考: https://developer.paddle.com/webhooks/overview
 */
async function verifyPaddleSignature(rawBody: string, signatureHeader: string | null): Promise<{ valid: boolean; error?: string }> {
  if (!PADDLE_WEBHOOK_SECRET) {
    console.error("CRITICAL: Paddle webhook secret not configured. Rejecting webhook in production.");
    // In production, this should never happen - fail closed
    return { valid: false, error: "Webhook secret not configured" };
  }

  if (!signatureHeader) {
    console.error("Webhook rejected: No Paddle-Signature header");
    return { valid: false, error: "Missing signature header" };
  }

  try {
    // Paddle 签名格式: "ts=timestamp,v1=signature"
    // Example: "ts=1234567890,v1=abc123..."
    const parts = signatureHeader.split(",");
    let timestamp = "";
    let signature = "";

    for (const part of parts) {
      const eqIndex = part.indexOf("=");
      if (eqIndex === -1) continue;
      const key = part.substring(0, eqIndex);
      const value = part.substring(eqIndex + 1);
      
      if (key === "ts") {
        timestamp = value;
      } else if (key === "v1") {
        signature = value;
      }
    }

    if (!timestamp || !signature) {
      console.error("Webhook rejected: Invalid signature format");
      return { valid: false, error: "Invalid signature format" };
    }

    // Check timestamp to prevent replay attacks
    const webhookTime = parseInt(timestamp, 10) * 1000; // Convert to ms
    const now = Date.now();
    const timeDiff = Math.abs(now - webhookTime);

    if (timeDiff > TIMESTAMP_TOLERANCE_MS) {
      console.error(`Webhook rejected: Timestamp too old or too far in future. Diff: ${timeDiff}ms`);
      return { valid: false, error: "Timestamp outside tolerance window" };
    }

    // Compute expected signature: HMAC-SHA256(timestamp + ":" + rawBody)
    // Paddle uses colon ":" as the separator between timestamp and rawBody
    const signedPayload = `${timestamp}:${rawBody}`;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(PADDLE_WEBHOOK_SECRET);
    const payloadData = encoder.encode(signedPayload);

    // Use Web Crypto API to compute HMAC-SHA256
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, payloadData);
    const signatureBytes = new Uint8Array(signatureBuffer);
    const expectedSignature = bytesToHex(signatureBytes);

    // Timing-safe comparison
    if (!timingSafeEqual(expectedSignature, signature)) {
      console.error("Webhook rejected: Signature mismatch");
      return { valid: false, error: "Signature mismatch" };
    }

    console.log("Webhook signature verified successfully");
    return { valid: true };

  } catch (err) {
    console.error("Webhook rejected: Signature verification error:", err);
    return { valid: false, error: "Signature verification failed" };
  }
}

/**
 * 使用数据库 RPC 原子处理支付事件
 */
async function processTransactionAtomic(
  transactionId: string,
  userId: string,
  planKey: string,
  credits: number,
  affiliateId?: string,
  affiliateCode?: string
): Promise<{ success: boolean; alreadyProcessed?: boolean; error?: string }> {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/process_paddle_completed_transaction`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          p_transaction_id: transactionId,
          p_user_id: userId,
          p_plan_key: planKey,
          p_credits: credits,
          p_affiliate_id: affiliateId || null,
          p_affiliate_code: affiliateCode || null,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("RPC call failed:", errorText);
      return { success: false, error: errorText };
    }

    const result = await response.json();
    console.log("RPC result:", JSON.stringify(result));

    if (result.already_processed) {
      console.log(`Transaction ${transactionId} already processed`);
      return { success: true, alreadyProcessed: true };
    }

    return { success: true };

  } catch (err) {
    console.error("RPC call error:", err);
    return { success: false, error: String(err) };
  }
}

Deno.serve(async (req: Request) => {
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
    // 1. 获取 raw body（用于签名验证）
    const bodyText = await req.text();
    console.log("📥 Received webhook event");

    // 2. 验证 Paddle 签名
    const signatureHeader = req.headers.get("paddle-signature");
    const signatureResult = await verifyPaddleSignature(bodyText, signatureHeader);
    
    if (!signatureResult.valid) {
      console.error(`❌ Webhook signature invalid: ${signatureResult.error}`);
      return new Response(
        JSON.stringify({ error: signatureResult.error }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. 解析 webhook 数据
    const webhookData = JSON.parse(bodyText);
    console.log("Event type:", webhookData.event_type);

    // 4. 只处理 transaction.completed 事件
    const eventType = webhookData.event_type;
    if (eventType !== "transaction.completed") {
      console.log(`Skipping event type: ${eventType}`);
      return new Response(
        JSON.stringify({ message: `Event type ${eventType} ignored` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. 解析事件数据
    const eventData = webhookData.data || webhookData;
    const customData = eventData.custom_data || {};
    const transactionId = eventData.id;

    // 读取 custom_data 中的信息
    const userId = customData.user_id;
    const planKey = customData.plan_key || customData.product;
    const affiliateId = customData.affiliate_id;
    const affiliateCode = customData.affiliate_code;

    if (!transactionId || !userId || !planKey) {
      console.error("Missing required fields in custom_data:", { transactionId, userId, planKey });
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing transaction: ${transactionId}, user: ${userId}, plan: ${planKey}`);

    // 6. 确定 credits 数量
    const creditsToAdd = PRODUCT_CREDITS[planKey] || 0;
    if (creditsToAdd === 0) {
      console.error(`Unknown plan key: ${planKey}`);
      return new Response(
        JSON.stringify({ error: "Unknown plan key" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 7. 使用原子 RPC 处理事务
    const processResult = await processTransactionAtomic(
      transactionId,
      userId,
      planKey,
      creditsToAdd,
      affiliateId,
      affiliateCode
    );

    if (!processResult.success) {
      console.error("Failed to process transaction:", processResult.error);
      return new Response(
        JSON.stringify({ error: "Failed to process transaction" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (processResult.alreadyProcessed) {
      console.log(`✅ Transaction ${transactionId} already processed (idempotent response)`);
      return new Response(
        JSON.stringify({ 
          message: "Already processed",
          transaction_id: transactionId 
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`✅ Transaction ${transactionId} processed successfully. Added ${creditsToAdd} credits.`);

    return new Response(
      JSON.stringify({
        success: true,
        transaction_id: transactionId,
        credits_added: creditsToAdd,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
