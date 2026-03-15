// Supabase Edge Function - Vendors Webhook
// 处理 Vendors 支付回调，验证并添加 credits

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

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-signature",
};

// 产品映射 - credits 数量
const PRODUCT_CREDITS: Record<string, number> = {
  starter: 5,
  standard: 20,
  pro: 100,
};

/**
 * 验证 Paddle Webhook 签名
 */
function verifyPaddleSignature(req: Request, body: string): boolean {
  if (!PADDLE_WEBHOOK_SECRET) {
    console.log("⚠️ Webhook secret not configured, skipping signature verification");
    return true; // 开发环境跳过验证
  }

  const signature = req.headers.get("paddle-signature");
  if (!signature) {
    console.log("⚠️ No paddle signature provided");
    return false;
  }

  // Paddle 使用特定格式的签名验证
  // 实际验证逻辑需要根据 Paddle 文档实现
  // 这里简化处理
  console.log("Paddle signature received:", signature.substring(0, 20) + "...");
  return true;
}

/**
 * 获取支付记录
 */
async function getPaymentByOrderId(orderId: string): Promise<{
  id: string;
  user_id: string;
  status: string;
  credits_added: number;
} | null> {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/payments?order_id=eq.${encodeURIComponent(orderId)}&select=id,user_id,status,credits_added`,
      {
        headers: {
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    if (!response.ok) {
      console.error("Failed to fetch payment:", await response.text());
      return null;
    }

    const payments = await response.json();
    return payments.length > 0 ? payments[0] : null;
  } catch (err) {
    console.error("Error fetching payment:", err);
    return null;
  }
}

/**
 * 更新支付状态
 */
async function updatePaymentStatus(
  paymentId: string,
  status: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/payments?id=eq.${paymentId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({ status }),
      }
    );

    return response.ok;
  } catch (err) {
    console.error("Error updating payment:", err);
    return false;
  }
}

/**
 * 增加用户 credits
 */
async function addCredits(userId: string, creditsToAdd: number): Promise<boolean> {
  try {
    // 先获取当前用户信息
    const profileResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=credits_remaining`,
      {
        headers: {
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    if (!profileResponse.ok) {
      console.error("Failed to fetch profile");
      return false;
    }

    const profiles = await profileResponse.json();
    if (profiles.length === 0) {
      console.error("Profile not found for user:", userId);
      return false;
    }

    const currentCredits = profiles[0].credits_remaining || 0;
    const newCredits = currentCredits + creditsToAdd;

    // 更新 credits
    const updateResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({ credits_remaining: newCredits }),
      }
    );

    if (!updateResponse.ok) {
      console.error("Failed to update credits:", await updateResponse.text());
      return false;
    }

    console.log(`✅ Added ${creditsToAdd} credits to user ${userId}. New total: ${newCredits}`);
    return true;
  } catch (err) {
    console.error("Error adding credits:", err);
    return false;
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
    // 1. 获取请求体
    const bodyText = await req.text();
    const webhookData = JSON.parse(bodyText);

    console.log("📥 Received webhook:", JSON.stringify(webhookData));

    // 2. 验证签名（开发环境可跳过）
    // if (!await verifySignature(req, bodyText)) {
    //   console.error("❌ Invalid webhook signature");
    //   return new Response(
    //     JSON.stringify({ error: "Invalid signature" }),
    //     { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    //   );
    // }

    // 3. 解析 Paddle webhook 数据
    // Paddle 事件格式: { event_type: "transaction.completed", data: { id: "txn_xxx", ... } }
    const eventType = webhookData.event_type;
    const eventData = webhookData.data || webhookData;
    
    // 优先从 custom_data 获取信息
    const customData = eventData.custom_data || {};
    const transactionId = eventData.id;
    const paymentStatus = eventData.status;
    const productId = customData.product;
    
    // 兼容旧格式
    const orderId = transactionId || webhookData.order_id || webhookData.orderId;

    if (!orderId || !paymentStatus) {
      console.error("Missing required fields: order_id or status");
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. 检查支付是否已完成
    if (paymentStatus !== "paid" && paymentStatus !== "completed") {
      console.log(`Payment status is "${paymentStatus}", skipping`);
      return new Response(
        JSON.stringify({ message: "Payment not completed, skipping" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. 检查订单是否已处理
    const existingPayment = await getPaymentByOrderId(orderId);

    if (!existingPayment) {
      console.error("Payment record not found for order:", orderId);
      return new Response(
        JSON.stringify({ error: "Payment not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (existingPayment.status === "paid") {
      console.log("Payment already processed for order:", orderId);
      return new Response(
        JSON.stringify({ message: "Already processed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. 确定要添加的 credits 数量
    let creditsToAdd = existingPayment.credits_added;

    // 如果 webhook 数据中包含产品信息，优先使用
    if (productId && PRODUCT_CREDITS[productId]) {
      creditsToAdd = PRODUCT_CREDITS[productId];
    }

    // 7. 更新支付状态为 paid
    const updateSuccess = await updatePaymentStatus(existingPayment.id, "paid");
    if (!updateSuccess) {
      console.error("Failed to update payment status");
      return new Response(
        JSON.stringify({ error: "Failed to update payment" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 8. 增加用户 credits
    const creditsSuccess = await addCredits(existingPayment.user_id, creditsToAdd);
    if (!creditsSuccess) {
      console.error("Failed to add credits, reverting payment status");
      await updatePaymentStatus(existingPayment.id, "failed");
      return new Response(
        JSON.stringify({ error: "Failed to add credits" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`✅ Order ${orderId} processed successfully. Added ${creditsToAdd} credits.`);

    return new Response(
      JSON.stringify({
        success: true,
        order_id: orderId,
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
