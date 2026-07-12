// Supabase Edge Function - Create Order
// Creates a Vendors checkout order for credits purchase

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

// API URL 根据环境区分
const PADDLE_API_URL = IS_SANDBOX
  ? "https://sandbox-api.paddle.com"
  : "https://api.paddle.com";

// Mock 模式：仅允许本地开发（当 PADDLE_ENV=local 且 PADDLE_API_KEY 为空时）
const IS_LOCAL = PADDLE_ENV === "local";
const IS_MOCK_MODE = IS_LOCAL && !Deno.env.get("PADDLE_API_KEY");

// Paddle API Key 校验（仅在非 mock 模式下）
const PADDLE_API_KEY = IS_MOCK_MODE ? "" : (Deno.env.get("PADDLE_API_KEY") || "");

function validateApiKey(): void {
  if (IS_MOCK_MODE) {
    console.log("⚠️ MOCK MODE: Paddle API not configured. Using mock checkout.");
    return;
  }

  if (!PADDLE_API_KEY) {
    throw new Error(
      `FATAL: PADDLE_API_KEY is empty. ` +
      `If you need mock mode for local development, set PADDLE_ENV=local and leave PADDLE_API_KEY empty. ` +
      `For sandbox/production, PADDLE_API_KEY is required.`
    );
  }

  if (IS_SANDBOX) {
    if (!PADDLE_API_KEY.startsWith("pdl_sdbx_apikey_")) {
      throw new Error(
        `FATAL: PADDLE_ENV=sandbox but PADDLE_API_KEY does not start with "pdl_sdbx_apikey_". ` +
        `Given key: ${PADDLE_API_KEY.slice(0, 20)}... ` +
        `Please check your PADDLE_API_KEY.`
      );
    }
  } else {
    if (!PADDLE_API_KEY.startsWith("pdl_live_apikey_")) {
      throw new Error(
        `FATAL: PADDLE_ENV=production but PADDLE_API_KEY does not start with "pdl_live_apikey_". ` +
        `Given key: ${PADDLE_API_KEY.slice(0, 20)}... ` +
        `Please check your PADDLE_API_KEY.`
      );
    }
  }
}

// 启动时校验 API Key
validateApiKey();

// 前端配置
const APP_URL = Deno.env.get("APP_URL") || "https://www.tryhomescope.com";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://trteewgplkqiedonomzg.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

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

// 获取环境隔离的 price_id
function getEnvironmentPriceId(planKey: string): string {
  const envKey = getPriceIdEnvKey(planKey, IS_SANDBOX);
  return getValidatedPriceId(envKey);
}

// 产品配置 - 使用环境隔离的 price_id
const PRODUCTS: Record<string, { credits: number; price: number; price_id: string }> = {
  starter: {
    credits: BASE_CREDITS.starter, // 1
    price: PLAN_PRICES.starter, // 6.99
    price_id: getEnvironmentPriceId("starter"),
  },
  standard: {
    credits: BASE_CREDITS.standard, // 3
    price: PLAN_PRICES.standard, // 15.99
    price_id: getEnvironmentPriceId("standard"),
  },
  pro: {
    credits: BASE_CREDITS.pro, // 10
    price: PLAN_PRICES.pro, // 39.99
    price_id: getEnvironmentPriceId("pro"),
  },
};

// ========== Auth 配置 ==========
const AUTH_URL = SUPABASE_URL;
const AUTH_ANON_KEY = Deno.env.get("AU_ANON_KEY") || "";

/**
 * 安全的用户验证：通过 Supabase Auth API 验证 token
 * 不再使用 atob 解析 JWT payload（那只是解码，不是验证）
 */
async function getCurrentUser(req: Request): Promise<{ userId: string | null; email: string | null; error: string | null }> {
  const authHeader = req.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { userId: null, email: null, error: "Missing or invalid Authorization header" };
  }

  const token = authHeader.replace("Bearer ", "");

  if (!token) {
    return { userId: null, email: null, error: "Empty token" };
  }

  // 使用 Supabase Auth API 验证 token
  if (!AUTH_ANON_KEY) {
    console.error("CRITICAL: AUTH_ANON_KEY (AU_ANON_KEY) is not set!");
    return { userId: null, email: null, error: "Server configuration error: missing auth key" };
  }

  try {
    const userResponse = await fetch(`${AUTH_URL}/auth/v1/user`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "apikey": AUTH_ANON_KEY,
      },
    });

    if (!userResponse.ok) {
      const errorText = await userResponse.text();
      console.error("Auth API failed:", userResponse.status, errorText.slice(0, 200));
      return { userId: null, email: null, error: "Invalid or expired token" };
    }

    const userData = await userResponse.json();

    if (!userData.id) {
      return { userId: null, email: null, error: "No user_id in auth response" };
    }

    console.log("User authenticated:", { userId: userData.id, email: userData.email });
    return { userId: userData.id, email: userData.email, error: null };
  } catch (err) {
    console.error("Auth error:", err);
    return { userId: null, email: null, error: "Authentication failed" };
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

  console.log("[create-order] environment:", IS_SANDBOX ? "sandbox" : "production");
  console.log("[create-order] price_id:", product.price_id);
  console.log("[create-order] product:", productId);

  // Mock 模式：仅在本地开发时可用
  if (IS_MOCK_MODE) {
    console.log("⚠️ MOCK MODE: Simulating Paddle checkout");

    const mockOrderId = `mock_${Date.now()}_${userId.slice(0, 8)}`;
    const mockCheckoutUrl = `${successUrl}?transaction_id=${mockOrderId}&status=completed&product=${productId}`;

    return {
      checkout_url: mockCheckoutUrl,
      transactionId: mockOrderId,
    };
  }

  try {
    const customData: Record<string, unknown> = {
      user_id: userId,
      product: 'homescope_credits',
      plan_key: productId,
      credits: product.credits,
      price_id: product.price_id,
      product_type: 'credits',
    };

    if (affiliate) {
      customData.affiliate_id = affiliate.id;
      customData.affiliate_code = affiliate.code;
    }

    console.log("[create-order] custom_data:", JSON.stringify(customData));

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
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const { userId, email, error: authError } = await getCurrentUser(req);
    if (authError || !userId || !email) {
      return new Response(
        JSON.stringify({ error: authError || "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { product, affiliate_code } = body;

    if (!product || !PRODUCTS[product]) {
      return new Response(
        JSON.stringify({ error: "Invalid product. Must be: starter, standard, or pro" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const productConfig = PRODUCTS[product];

    let affiliate: { id: string; code: string } | undefined;

    if (affiliate_code && typeof affiliate_code === 'string') {
      const code = affiliate_code.trim().toUpperCase();

      if (code.length > 0) {
        console.log("[create-order] Validating affiliate code:", code);

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

    const baseUrl = req.headers.get("origin") || SUPABASE_URL;
    const successUrl = `${baseUrl}/payment-success`;
    const cancelUrl = `${baseUrl}/pricing`;

    const orderResult = await createPaddleTransaction(product, userId, email, successUrl, cancelUrl, affiliate);

    if ("error" in orderResult) {
      return new Response(
        JSON.stringify({ error: orderResult.error }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await createPaymentRecord(
      userId,
      orderResult.transactionId,
      product,
      productConfig.credits,
      productConfig.price,
      orderResult.transactionId
    );

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
