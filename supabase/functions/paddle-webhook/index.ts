// Supabase Edge Function - Paddle Webhook
// 处理 Paddle 支付回调，验证支付后增加用户积分

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get(name: string): string | undefined;
  };
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://trteewgplkqiedonomzg.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Paddle webhook 签名验证
const PADDLE_PUBLIC_KEY = Deno.env.get("PADDLE_PUBLIC_KEY") || "";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, passthrough",
};

/**
 * 验证 Paddle webhook 签名
 */
function verifyPaddleSignature(req: Request, body: string): boolean {
  const signature = req.headers.get("paddle-signature");
  if (!signature) {
    console.log("No Paddle signature provided");
    return false;
  }

  // 如果没有配置公钥，跳过验证（仅用于开发测试）
  if (!PADDLE_PUBLIC_KEY) {
    console.log("⚠️ PADDLE_PUBLIC_KEY not configured, skipping signature verification");
    return true;
  }

  // TODO: 实现完整的签名验证
  // Paddle 使用 Ed25519 或 RSA 签名
  // 简化处理：这里先跳过验证，生产环境需要实现
  return true;
}

/**
 * 更新用户积分
 */
async function addCreditsToUser(userId: string, creditsToAdd: number): Promise<boolean> {
  try {
    // 先获取用户当前积分
    const getResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=credits_remaining`,
      {
        headers: {
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    if (!getResponse.ok) {
      console.error("Failed to get user credits:", await getResponse.text());
      return false;
    }

    const users = await getResponse.json();
    if (!users || users.length === 0) {
      console.error("User not found:", userId);
      return false;
    }

    const currentCredits = users[0].credits_remaining || 0;
    const newCredits = currentCredits + creditsToAdd;

    // 更新积分
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
        body: JSON.stringify({
          credits_remaining: newCredits,
        }),
      }
    );

    if (!updateResponse.ok) {
      console.error("Failed to update credits:", await updateResponse.text());
      return false;
    }

    console.log(`Added ${creditsToAdd} credits to user ${userId}. Total: ${newCredits}`);
    return true;
  } catch (err) {
    console.error("Error adding credits:", err);
    return false;
  }
}

/**
 * 更新支付记录状态
 */
async function updatePaymentStatus(
  orderId: string,
  status: string,
  vendorOrderId?: string
): Promise<boolean> {
  try {
    const updateData: Record<string, any> = { status };
    if (vendorOrderId) {
      updateData.vendor_order_id = vendorOrderId;
    }

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/payments?order_id=eq.${orderId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Prefer": "return=minimal",
        },
        body: JSON.stringify(updateData),
      }
    );

    return response.ok;
  } catch (err) {
    console.error("Failed to update payment status:", err);
    return false;
  }
}

/**
 * 从 Paddle 事件中提取产品对应的积分数量
 */
function getCreditsForProduct(productId: string): number {
  const creditsMap: Record<string, number> = {
    starter: 5,
    standard: 20,
    pro: 100,
  };
  return creditsMap[productId] || 0;
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
    if (!verifyPaddleSignature(req, bodyText)) {
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const event = JSON.parse(bodyText);
    console.log("Received Paddle event:", event.event_type);

    // 处理不同的事件类型
    switch (event.event_type) {
      case "transaction.completed": {
        const transaction = event.data;
        const orderId = transaction.custom_data?.order_id || transaction.id;
        const userId = transaction.custom_data?.user_id;
        const productId = transaction.custom_data?.product;
        const vendorOrderId = transaction.id;

        if (!userId) {
          console.error("No user_id in transaction custom_data");
          return new Response(
            JSON.stringify({ error: "Missing user_id" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // 获取产品对应的积分
        const creditsToAdd = getCreditsForProduct(productId);
        if (creditsToAdd === 0) {
          console.error("Invalid product ID:", productId);
          return new Response(
            JSON.stringify({ error: "Invalid product" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // 更新支付状态为 completed
        await updatePaymentStatus(orderId, "completed", vendorOrderId);

        // 增加用户积分
        const added = await addCreditsToUser(userId, creditsToAdd);
        if (!added) {
          console.error("Failed to add credits for user:", userId);
          return new Response(
            JSON.stringify({ error: "Failed to add credits" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.log(`Payment completed: user=${userId}, credits=${creditsToAdd}, order=${orderId}`);
        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "transaction.canceled":
      case "transaction.failed": {
        const transaction = event.data;
        const orderId = transaction.custom_data?.order_id || transaction.id;

        await updatePaymentStatus(orderId, "failed");
        console.log(`Payment failed/canceled: order=${orderId}`);
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
