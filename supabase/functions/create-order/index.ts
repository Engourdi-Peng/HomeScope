// Supabase Edge Function - Create Order
// Creates a Vendors checkout order for credits purchase

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get(name: string): string | undefined;
  };
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://trteewgplkqiedonomzg.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

// Paddle API 配置 - 需要在 Supabase Dashboard 中设置
// PADDLE_API_KEY: 你的 Paddle API 密钥 (格式: pdl_live_apikey_xxx)
const PADDLE_API_KEY = Deno.env.get("PADDLE_API_KEY") || "";
const PADDLE_API_URL = Deno.env.get("PADDLE_API_URL") || "https://api.paddle.com";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 产品配置 - 使用 Paddle Price ID
const PRODUCTS: Record<string, { credits: number; price: number; price_id: string }> = {
  starter: {
    credits: 5,
    price: 4.99,
    price_id: Deno.env.get("PRICE_STARTER") || "pri_01kks139q622jr8ptw08ht53qh",
  },
  standard: {
    credits: 20,
    price: 9.99,
    price_id: Deno.env.get("PRICE_STANDARD") || "pri_01kks17qba3wgkq10xc1d6pmrz",
  },
  pro: {
    credits: 100,
    price: 29.0,
    price_id: Deno.env.get("PRICE_PRO") || "pri_01kks192dxcy6m53g0vbgfcyh0",
  },
};

/**
 * 从 JWT token 直接解析用户信息（无需额外 API 调用）
 */
function getCurrentUser(req: Request): { userId: string | null; email: string | null; error: string | null } {
  const authHeader = req.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { userId: null, email: null, error: "Missing or invalid Authorization header" };
  }

  const token = authHeader.replace("Bearer ", "");

  // 直接从 JWT payload 解析 user_id
  // JWT 格式: header.payload.signature，payload 是 base64 编码的 JSON
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return { userId: null, email: null, error: "Invalid token format" };
    }

    // 解码 payload（base64url → base64 → JSON）
    const payloadBase64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payloadJson = atob(payloadBase64);
    const payload = JSON.parse(payloadJson);

    // Supabase JWT 包含 sub（用户 ID）和 email
    const userId = payload.sub;
    const email = payload.email;

    if (!userId) {
      return { userId: null, email: null, error: "No user_id in token" };
    }

    console.log("Token parsed successfully:", { userId, email });
    return { userId, email, error: null };
  } catch (err) {
    console.error("Token parse error:", err);
    return { userId: null, email: null, error: "Invalid token" };
  }
}

/**
 * 创建 Paddle 交易并获取 checkout URL
 */
async function createPaddleTransaction(
  productId: string,
  userId: string,
  email: string,
  successUrl: string,
  cancelUrl: string
): Promise<{ checkout_url: string; transactionId: string } | { error: string }> {
  const product = PRODUCTS[productId];
  if (!product) {
    return { error: "Invalid product ID" };
  }

  // 如果没有配置 Paddle API，使用模拟模式（用于开发测试）
  if (!PADDLE_API_KEY) {
    console.log("⚠️ Paddle API not configured, using mock mode");

    // 生成模拟订单 ID
    const mockOrderId = `mock_${Date.now()}_${userId.slice(0, 8)}`;
    const mockCheckoutUrl = `${successUrl}?transaction_id=${mockOrderId}&status=completed&product=${productId}`;

    return {
      checkout_url: mockCheckoutUrl,
      transactionId: mockOrderId,
    };
  }

  try {
    // 调用 Paddle API 创建交易
    const response = await fetch(`${PADDLE_API_URL}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${PADDLE_API_KEY}`,
        "Paddle-Idempotency-Key": `txn_${Date.now()}_${userId.slice(0, 8)}`,
      },
      body: JSON.stringify({
        items: [
          {
            price_id: product.price_id,
            quantity: 1,
          },
        ],
        custom_data: {
          user_id: userId,
          product: productId,
        },
        checkout: {
          url: null, // 使用 Paddle 默认的 checkout URL
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Paddle API error:", errorText);
      return { error: `Failed to create transaction: ${response.statusText}` };
    }

    const data = await response.json();
    
    // Paddle 返回的 checkout URL 在 checkout.url 中
    // 格式: {default_checkout_url}?_ptxn={transaction_id}
    const checkoutUrl = data.data.checkout?.url;
    
    if (!checkoutUrl) {
      console.error("No checkout URL in response:", data);
      return { error: "No checkout URL returned from Paddle" };
    }

    return {
      checkout_url: checkoutUrl,
      transactionId: data.data.id,
    };
  } catch (err) {
    console.error("Paddle API exception:", err);
    return { error: "Failed to connect to payment provider" };
  }
}

/**
 * 在数据库中创建 pending 支付记录
 */
async function createPaymentRecord(
  userId: string,
  orderId: string,
  productId: string,
  creditsAdded: number,
  amount: number,
  vendorOrderId?: string
): Promise<boolean> {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({
        user_id: userId,
        order_id: orderId,
        product_id: productId,
        credits_added: creditsAdded,
        amount: amount,
        status: "pending",
        vendor_order_id: vendorOrderId || orderId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to create payment record:", errorText);
      return false;
    }

    return true;
  } catch (err) {
    console.error("Failed to create payment record:", err);
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
    // 1. 验证用户登录
    const { userId, email, error: authError } = await getCurrentUser(req);
    if (authError || !userId || !email) {
      return new Response(
        JSON.stringify({ error: authError || "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. 解析请求体
    const body = await req.json();
    const { product } = body;

    if (!product || !PRODUCTS[product]) {
      return new Response(
        JSON.stringify({ error: "Invalid product. Must be: starter, standard, or pro" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const productConfig = PRODUCTS[product];

    // 3. 构建回调 URL
    const baseUrl = req.headers.get("origin") || SUPABASE_URL;
    const successUrl = `${baseUrl}/payment-success`;
    const cancelUrl = `${baseUrl}/pricing`;

    // 4. 创建 Paddle 交易
    const orderResult = await createPaddleTransaction(product, userId, email, successUrl, cancelUrl);

    if ("error" in orderResult) {
      return new Response(
        JSON.stringify({ error: orderResult.error }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. 创建 pending 支付记录
    await createPaymentRecord(
      userId,
      orderResult.transactionId,
      product,
      productConfig.credits,
      productConfig.price,
      orderResult.transactionId
    );

    // 6. 返回 checkout URL
    if (!orderResult.checkout_url) {
      return new Response(
        JSON.stringify({ error: "Missing checkout_url from payment provider" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[create-order] returning checkout_url:", orderResult.checkout_url);

    return new Response(
      JSON.stringify({
        success: true,
        checkout_url: orderResult.checkout_url,
        transaction_id: orderResult.transactionId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Create order error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
