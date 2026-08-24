// Supabase Edge Function - Public Articles API
//
// 公开端点：列出已发布文章、按 slug 取文章详情、按分类聚合。
// 使用 service_role key 拼装数据，避免 RLS 在不同环境下表现不一致。
//
// 部署：npx supabase functions deploy articles-public
// 允许匿名访问（verify_jwt = false）

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get(name: string): string | undefined;
  };
};

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") || "https://trteewgplkqiedonomzg.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SERVICE_ROLE_KEY") ||
  "";
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ||
  Deno.env.get("ANON_KEY") ||
  "";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

function authHeader() {
  return {
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json",
  };
}

const PUBLIC_FIELDS =
  "id,slug,title,excerpt,content_html,cover_image_url,cover_alt,category_id,tags,author_name,status,published_at,updated_at,reading_time_minutes,seo_title,seo_description,canonical_url,og_image_url,noindex";

interface PublicArticle {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content_html: string;
  cover_image_url: string | null;
  cover_alt: string | null;
  category_id: string | null;
  tags: string[];
  author_name: string;
  status: string;
  published_at: string | null;
  updated_at: string;
  reading_time_minutes: number;
  seo_title: string | null;
  seo_description: string | null;
  canonical_url: string | null;
  og_image_url: string | null;
  noindex: boolean;
}

async function fetchPublished(slug: string): Promise<PublicArticle | null> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/articles`);
  url.searchParams.set("slug", `eq.${slug}`);
  url.searchParams.set("status", "eq.published");
  url.searchParams.set("select", PUBLIC_FIELDS);
  url.searchParams.set("limit", "1");
  const res = await fetch(url.toString(), { headers: authHeader() });
  if (!res.ok) return null;
  const rows = (await res.json()) as PublicArticle[];
  if (!rows.length) return null;
  const row = rows[0];
  if (row.noindex) return null;
  if (row.published_at && new Date(row.published_at).getTime() > Date.now()) return null;
  return row;
}

async function fetchRedirect(slug: string): Promise<string | null> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/article_redirects`);
  url.searchParams.set("old_slug", `eq.${slug}`);
  url.searchParams.set("select", "new_slug");
  url.searchParams.set("limit", "1");
  const res = await fetch(url.toString(), { headers: authHeader() });
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{ new_slug: string }>;
  return rows[0]?.new_slug ?? null;
}

async function listPublished(opts: {
  limit: number;
  offset: number;
  categorySlug?: string;
  tag?: string;
  q?: string;
}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/articles`);
  url.searchParams.set("status", "eq.published");
  url.searchParams.set("noindex", "eq.false");
  url.searchParams.set(
    "select",
    "id,slug,title,excerpt,cover_image_url,cover_alt,category_id,tags,author_name,published_at,reading_time_minutes"
  );
  url.searchParams.set("order", "published_at.desc");
  url.searchParams.set("limit", String(opts.limit));
  url.searchParams.set("offset", String(opts.offset));

  if (opts.tag) url.searchParams.set("tags", `cs.{${opts.tag}}`);
  if (opts.q) url.searchParams.set("title", `ilike.*${opts.q.replace(/[%_]/g, "")}*`);

  let rows = (await (await fetch(url.toString(), { headers: authHeader() })).json()) as any[];

  if (opts.categorySlug) {
    const catUrl = new URL(`${SUPABASE_URL}/rest/v1/article_categories`);
    catUrl.searchParams.set("slug", `eq.${opts.categorySlug}`);
    catUrl.searchParams.set("select", "id");
    const catRes = await fetch(catUrl.toString(), { headers: authHeader() });
    if (!catRes.ok) return { rows: [], total: 0 };
    const cats = (await catRes.json()) as Array<{ id: string }>;
    if (!cats.length) return { rows: [], total: 0 };
    rows = rows.filter((r) => r.category_id === cats[0].id);
  }

  return { rows, total: rows.length };
}

async function listCategories() {
  const url = new URL(`${SUPABASE_URL}/rest/v1/article_categories`);
  url.searchParams.set("is_active", "eq.true");
  url.searchParams.set("order", "sort_order.asc,name.asc");
  url.searchParams.set("select", "id,slug,name,description,seo_title,seo_description");
  const res = await fetch(url.toString(), { headers: authHeader() });
  if (!res.ok) return [];
  return res.json();
}

async function relatedArticles(article: PublicArticle, count = 3): Promise<any[]> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/articles`);
  url.searchParams.set("status", "eq.published");
  url.searchParams.set("noindex", "eq.false");
  url.searchParams.set("id", `neq.${article.id}`);
  url.searchParams.set(
    "select",
    "id,slug,title,excerpt,cover_image_url,cover_alt,category_id,published_at,reading_time_minutes"
  );
  url.searchParams.set("limit", String(count));
  url.searchParams.set("order", "published_at.desc");
  if (article.category_id) {
    url.searchParams.set("category_id", `eq.${article.category_id}`);
  }
  const res = await fetch(url.toString(), { headers: authHeader() });
  if (!res.ok) return [];
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "";

  try {
    if (action === "list") {
      const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "12", 10)));
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const categorySlug = url.searchParams.get("category") || undefined;
      const tag = url.searchParams.get("tag") || undefined;
      const q = url.searchParams.get("q") || undefined;
      const result = await listPublished({ limit, offset: (page - 1) * limit, categorySlug, tag, q });
      return new Response(
        JSON.stringify({ ...result, page, limit }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=60, s-maxage=300" } }
      );
    }

    if (action === "get") {
      const slug = url.searchParams.get("slug") || "";
      if (!slug) return jsonResponse({ error: "slug is required" }, 400);

      const direct = await fetchPublished(slug);
      let article = direct;
      let redirect: string | null = null;
      if (!article) {
        redirect = await fetchRedirect(slug);
        if (redirect) article = await fetchPublished(redirect);
      }
      if (!article) return jsonResponse({ error: "Not found", redirect }, 404);

      const related = await relatedArticles(article, 3);
      return new Response(
        JSON.stringify({ article, related, redirect }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=60, s-maxage=300" } }
      );
    }

    if (action === "categories") {
      const categories = await listCategories();
      return new Response(JSON.stringify({ categories }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=300, s-maxage=600" },
      });
    }

    if (action === "redirect") {
      const slug = url.searchParams.get("slug") || "";
      if (!slug) return jsonResponse({ error: "slug is required" }, 400);
      const newSlug = await fetchRedirect(slug);
      return new Response(JSON.stringify({ redirect: newSlug }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "is-admin") {
      // 前端路由守卫用：验证当前用户 JWT 是否落在 article_admins 白名单。
      // 用 anon key 解析 user JWT（确保签名合法），再用 service_role 查白名单
      // —— service_role 绕过 RLS，避免把 article_admins 直接暴露给前端。
      const auth = req.headers.get("authorization") || "";
      const token = auth.replace(/^Bearer\s+/i, "").trim();
      if (!token || !SUPABASE_ANON_KEY) {
        return jsonResponse({ isAdmin: false }, 200);
      }

      let userId = "";
      try {
        const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: SUPABASE_ANON_KEY,
          },
        });
        if (userRes.ok) {
          const userJson = await userRes.json();
          userId = userJson?.id || "";
        }
      } catch {
        userId = "";
      }

      if (!userId) {
        return jsonResponse({ isAdmin: false }, 200);
      }

      const adminRes = await fetch(
        `${SUPABASE_URL}/rest/v1/article_admins?user_id=eq.${userId}&select=user_id&limit=1`,
        { headers: authHeader() }
      );
      if (!adminRes.ok) {
        return jsonResponse({ isAdmin: false }, 200);
      }
      const rows = (await adminRes.json()) as Array<{ user_id: string }>;
      return jsonResponse({ isAdmin: Array.isArray(rows) && rows.length > 0 }, 200);
    }

    return jsonResponse({ error: `Unknown action ${action}` }, 400);
  } catch (error) {
    console.error("articles-public error:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Internal error" }, 500);
  }
});

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}