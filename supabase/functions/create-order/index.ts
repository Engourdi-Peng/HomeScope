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

// Vendors API 配置 - 需要在 Supabase Dashboard 中设置
// VENDORS_API_KEY: 你的 Vendors API 密钥
// VENDORS_MERCHANT_ID: 你的 Vendors Merchant ID
const VENDORS_API_KEY = Deno.env.get("VENDORS_API_KEY") || "";
const VENDORS_MERCHANT_ID = Deno.env.get("VENDORS_MERCHANT_ID") || "";
const VENDORS_API_URL = Deno.env.get("VENDORS_API_URL") || "https://api.vendors.com/v1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 产品配置
const PRODUCTS: Record<string, { credits: number; price: number; vendor_product_id: string }> = {
  starter: {
    credits: 5,
    price: 4.99,
    vendor_product_id: Deno.env.get("VENDORS_PRODUCT_STARTER") || "prod_starter",
  },
  standard: {
    credits: 20,
    price: 9.99,
    vendor_product_id: Deno.env.get("VENDORS_PRODUCT_STANDARD") || "prod_standard",
  },
  pro: {
    credits: 100,
    price: 29.0,
    vendor_product_id: Deno.env.get("VENDORS_PRODUCT_PRO") || "prod_pro",
  },
};

/**
 * 获取当前用户
 */
async function getCurrentUser(req: Request): Promise<{ userId: string | null; email: string | null; error: string | null }> {
  const authHeader = req.headers.get("Authorization");
  const apikey = req.headers.get("apikey");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { userId: null, email: null, error: "Missing or invalid Authorization header" };
  }

  const token = authHeader.replace("Bearer ", "");

  try {
    // 验证 token 获取用户信息
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "apikey": SUPABASE_ANON_KEY,
      },
    });

    if (!userResponse.ok) {
      return { userId: null, email: null, error: "Invalid or expired token" };
    }

    const userData = await userResponse.json();
    return { userId: userData.id, email: userData.email, error: null };
  } catch (err) {
    console.error("Auth error:", err);
    return { userId: null, email: null, error: "Authentication failed" };
  }
}

/**
 * 创建 Vendors 订单
 */
async function createVendorsOrder(
  productId: string,
  userId: string,
  email: string,
  successUrl: string,
  cancelUrl: string
): Promise<{ checkoutUrl: string; orderId: string } | { error: string }> {
  const product = PRODUCTS[productId];
  if (!product) {
    return { error: "Invalid product ID" };
  }

  // 如果没有配置 Vendors API，使用模拟模式（用于开发测试）
  if (!VENDORS_API_KEY || !VENDORS_MERCHANT_ID) {
    console.log("⚠️ Vendors API not configured, using mock mode");

    // 生成模拟订单 ID
    const mockOrderId = `mock_${Date.now()}_${userId.slice(0, 8)}`;
    const mockCheckoutUrl = `${successUrl}?order_id=${mockOrderId}&status=paid&product=${productId}`;

    return {
      checkoutUrl: mockCheckoutUrl,
      orderId: mockOrderId,
    };
  }

  try {
    // 调用 Vendors API 创建订单
    const response = await fetch(`${VENDORS_API_URL}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${VENDORS_API_KEY}`,
        "X-Merchant-ID": VENDORS_MERCHANT_ID,
      },
      body: JSON.stringify({
        product_id: product.vendor_product_id,
        quantity: 1,
        customer: {
          email: email,
          metadata: {
            user_id: userId,
          },
        },
        success_url: successUrl,
        cancel_url: cancelUrl,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Vendors API error:", errorText);
      return { error: `Failed to create order: ${response.statusText}` };
    }

    const data = await response.json();
    return {
      checkoutUrl: data.checkout_url,
      orderId: data.order_id,
    };
  } catch (err) {
    console.error("Vendors API exception:", err);
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
    return new Response(null, { headers: corsHeaders });
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

    // 4. 创建 Vendors 订单
    const orderResult = await createVendorsOrder(product, userId, email, successUrl, cancelUrl);

    if ("error" in orderResult) {
      return new Response(
        JSON.stringify({ error: orderResult.error }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. 创建 pending 支付记录
    await createPaymentRecord(
      userId,
      orderResult.orderId,
      product,
      productConfig.credits,
      productConfig.price,
      orderResult.orderId
    );

    // 6. 返回 checkout URL
    return new Response(
      JSON.stringify({
        checkout_url: orderResult.checkoutUrl,
        order_id: orderResult.orderId,
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
