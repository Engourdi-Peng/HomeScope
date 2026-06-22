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
const APP_URL = Deno.env.get("APP_URL") || "https://www.tryhomescope.com";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

// 产品配置 - 使用 Paddle Price ID (从环境变量读取)
const PRODUCTS: Record<string, { credits: number; price: number; price_id: string }> = {
  starter: {
    credits: 3,
    price: 6.99,
    price_id: getValidatedPriceId("PRICE_STARTER"),
  },
  standard: {
    credits: 10,
    price: 14.99,
    price_id: getValidatedPriceId("PRICE_STANDARD"),
  },
  pro: {
    credits: 40,
    price: 39.0,
    price_id: getValidatedPriceId("PRICE_PRO"),
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
  cancelUrl: string,
  affiliate?: { id: string; code: string }
): Promise<{ checkout_url: string; transactionId: string } | { error: string }> {
  const product = PRODUCTS[productId];
  if (!product) {
    return { error: "Invalid product ID" };
  }

  console.log("[create-order] price_id:", product.price_id);
  console.log("[create-order] product:", productId);

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
    // 构建 custom_data（包含 affiliate 信息和完整的产品数据）
    const customData: Record<string, unknown> = {
      user_id: userId,
      product: 'homescope_credits',
      plan_key: productId,
      credits: product.credits,
      price_id: product.price_id,
      product_type: 'credits',
    };

    // 如果有有效的 affiliate code，添加到 custom_data
    if (affiliate) {
      customData.affiliate_id = affiliate.id;
      customData.affiliate_code = affiliate.code;
    }

    console.log("[create-order] custom_data:", JSON.stringify(customData));

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
        custom_data: customData,
        checkout: {
          return_url: `${APP_URL}/checkout?_ptxn={transaction_id}`,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Paddle API error:", errorText);
      return { error: `Failed to create transaction: ${response.statusText}` };
    }

    const data = await response.json();

    // 手动构建 checkout_url，指向我们自己的网站
    // Paddle 会用 {transaction_id} 替换占位符
    const transactionId = data.data.id;
    const checkoutUrl = `${APP_URL}/checkout?_ptxn=${transactionId}`;

    console.log("[create-order] checkout_url:", checkoutUrl);
    console.log("[create-order] transactionId:", transactionId);

    return {
      checkout_url: checkoutUrl,
      transactionId: transactionId,
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
    const { product, affiliate_code } = body;

    if (!product || !PRODUCTS[product]) {
      return new Response(
        JSON.stringify({ error: "Invalid product. Must be: starter, standard, or pro" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const productConfig = PRODUCTS[product];

    // 3. 验证 affiliate_code（如果存在）
    let affiliate: { id: string; code: string } | undefined;

    if (affiliate_code && typeof affiliate_code === 'string') {
      const code = affiliate_code.trim().toUpperCase();

      if (code.length > 0) {
        console.log("[create-order] Validating affiliate code:", code);

        // 查询 affiliates 表
        const affiliateResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/affiliates?code=eq.${encodeURIComponent(code)}&is_active=eq.true&select=id,code`,
          {
            headers: {
              "apikey": SUPABASE_SERVICE_ROLE_KEY,
              "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
          }
        );

        if (!affiliateResponse.ok) {
          console.error("[create-order] Failed to query affiliates:", await affiliateResponse.text());
        } else {
          const affiliates = await affiliateResponse.json();
          if (affiliates && affiliates.length > 0) {
            affiliate = {
              id: affiliates[0].id,
              code: affiliates[0].code,
            };
            console.log("[create-order] Valid affiliate:", affiliate);
          } else {
            console.log("[create-order] Invalid affiliate code:", code);
            return new Response(
              JSON.stringify({ error: "INVALID_AFFILIATE_CODE" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }
      }
    }

    // 4. 构建回调 URL
    const baseUrl = req.headers.get("origin") || SUPABASE_URL;
    const successUrl = `${baseUrl}/payment-success`;
    const cancelUrl = `${baseUrl}/pricing`;

    // 5. 创建 Paddle 交易（传入 affiliate 信息）
    const orderResult = await createPaddleTransaction(product, userId, email, successUrl, cancelUrl, affiliate);

    if ("error" in orderResult) {
      return new Response(
        JSON.stringify({ error: orderResult.error }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. 创建 pending 支付记录
    await createPaymentRecord(
      userId,
      orderResult.transactionId,
      product,
      productConfig.credits,
      productConfig.price,
      orderResult.transactionId
    );

    // 7. 返回 checkout URL
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
