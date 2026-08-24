// Supabase Edge Function - Articles Admin API
//
// 单管理员后台使用的文章 CRUD 接口。所有写入路径都通过 service_role 操作
// `articles`、`article_categories`、`article_redirects` 表与 `article-media`
// 存储桶。前端 React 后台只调用本接口，不直接持有 service_role key。
//
// 部署：npx supabase functions deploy articles-admin
// 关网关 JWT 校验（与 analyze / paddle-webhook 一致）：supabase/config.toml 中
// `verify_jwt = false`，函数内部自行校验登录态与管理员白名单。

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get(name: string): string | undefined;
  };
};

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") ||
  Deno.env.get("PRIMARY_SUPABASE_URL") ||
  "https://trteewgplkqiedonomzg.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SERVICE_ROLE_KEY") ||
  "";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_TITLE = 200;
const MAX_EXCERPT = 500;
const MAX_SEO_TITLE = 70;
const MAX_SEO_DESC = 200;
const MAX_MARKDOWN = 200_000;

interface UserPayload {
  id: string;
  email?: string;
}

function decodeJWT(token: string): UserPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const padded = payload + "=".repeat((4 - payload.length % 4) % 4);
    const decoded = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    const data = JSON.parse(decoded);
    if (!data.sub) return null;
    return { id: data.sub, email: data.email };
  } catch {
    return null;
  }
}

function authHeader() {
  return {
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json",
  };
}

async function isAdmin(userId: string): Promise<boolean> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/article_admins`);
  url.searchParams.set("user_id", `eq.${userId}`);
  url.searchParams.set("select", "user_id");
  const res = await fetch(url.toString(), { headers: authHeader() });
  if (!res.ok) return false;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

function slugify(input: string): string {
  return (input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function estimateReadingMinutes(markdown: string): number {
  const words = (markdown || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

function wordCount(markdown: string): number {
  return (markdown || "").trim().split(/\s+/).filter(Boolean).length;
}

/**
 * 极简 markdown -> HTML 渲染器：
 * - 支持标题、段落、粗体/斜体、行内 code、链接、列表、引用、水平线、代码块；
 * - 所有 HTML 实体与原始 HTML 已转义，避免 XSS；
 * - 段落、行内 code、链接 URL 通过白名单限制；不引入额外依赖。
 */
function escapeHtml(input: string): string {
  return (input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (/^(javascript|data|vbscript):/i.test(trimmed)) return false;
  return /^(https?:|mailto:|\/|#)/i.test(trimmed);
}

function renderInline(text: string): string {
  let out = escapeHtml(text);
  // inline code
  out = out.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  // bold
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // italic
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  // links: [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) =>
    isSafeUrl(url)
      ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${label}</a>`
      : label
  );
  return out;
}

function renderMarkdown(md: string): string {
  const lines = (md || "").split(/\r?\n/);
  const html: string[] = [];
  let i = 0;
  let inList: "ul" | "ol" | null = null;
  let inCode = false;
  let codeBuf: string[] = [];

  const closeList = () => {
    if (inList) {
      html.push(`</${inList}>`);
      inList = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    if (inCode) {
      if (/^```/.test(line)) {
        html.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        codeBuf.push(line);
      }
      i++;
      continue;
    }

    if (/^```/.test(line)) {
      closeList();
      inCode = true;
      i++;
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      const level = h[1].length;
      html.push(`<h${level}>${renderInline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ol) {
      if (inList !== "ol") {
        closeList();
        inList = "ol";
        html.push("<ol>");
      }
      html.push(`<li>${renderInline(ol[1])}</li>`);
      i++;
      continue;
    }
    if (ul) {
      if (inList !== "ul") {
        closeList();
        inList = "ul";
        html.push("<ul>");
      }
      html.push(`<li>${renderInline(ul[1])}</li>`);
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      closeList();
      html.push(`<blockquote>${renderInline(line.replace(/^>\s?/, ""))}</blockquote>`);
      i++;
      continue;
    }

    if (/^---+\s*$/.test(line)) {
      closeList();
      html.push("<hr />");
      i++;
      continue;
    }

    if (line.trim() === "") {
      closeList();
      i++;
      continue;
    }

    // paragraph: collect consecutive non-blank lines
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,4})\s/.test(lines[i]) && !/^```/.test(lines[i]) && !/^\s*[-*]\s/.test(lines[i]) && !/^\s*\d+\.\s/.test(lines[i]) && !/^>\s?/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    closeList();
    html.push(`<p>${renderInline(para.join(" "))}</p>`);
  }
  closeList();
  return html.join("\n");
}

interface ArticleInput {
  id?: string;
  title?: unknown;
  slug?: unknown;
  excerpt?: unknown;
  content_markdown?: unknown;
  cover_image_url?: unknown;
  cover_alt?: unknown;
  category_id?: unknown;
  tags?: unknown;
  status?: unknown;
  scheduled_for?: unknown;
  seo_title?: unknown;
  seo_description?: unknown;
  canonical_url?: unknown;
  og_image_url?: unknown;
  noindex?: unknown;
  author_name?: unknown;
}

function asString(v: unknown, max = 1000): string | undefined {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim().slice(0, max);
  return trimmed;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((item): item is string => typeof item === "string")
    .map((s) => s.trim().toLowerCase().slice(0, 40))
    .filter(Boolean)
    .slice(0, 20);
}

function validateStatus(v: unknown): "draft" | "review" | "scheduled" | "published" | "archived" | undefined {
  if (typeof v !== "string") return undefined;
  if (["draft", "review", "scheduled", "published", "archived"].includes(v)) {
    return v as "draft" | "review" | "scheduled" | "published" | "archived";
  }
  return undefined;
}

function validateInput(input: ArticleInput, isCreate: boolean) {
  const errors: string[] = [];
  const title = asString(input.title, MAX_TITLE);
  if (isCreate && !title) errors.push("title is required");

  let slug = asString(input.slug, 80)?.toLowerCase();
  if (slug && !SLUG_PATTERN.test(slug)) {
    errors.push("slug must match /^[a-z0-9]+(?:-[a-z0-9]+)*$/");
  }

  const content = asString(input.content_markdown, MAX_MARKDOWN) ?? "";

  const seo_title = asString(input.seo_title, MAX_SEO_TITLE);
  const seo_description = asString(input.seo_description, MAX_SEO_DESC);
  const excerpt = asString(input.excerpt, MAX_EXCERPT);
  const canonical_url = asString(input.canonical_url, 500);
  const cover_image_url = asString(input.cover_image_url, 1000);
  const og_image_url = asString(input.og_image_url, 1000);
  const cover_alt = asString(input.cover_alt, 200);

  const status = validateStatus(input.status);

  if (seo_title && seo_title.length > MAX_SEO_TITLE) {
    errors.push(`seo_title exceeds ${MAX_SEO_TITLE} chars`);
  }
  if (seo_description && seo_description.length > MAX_SEO_DESC) {
    errors.push(`seo_description exceeds ${MAX_SEO_DESC} chars`);
  }

  return {
    errors,
    cleaned: {
      title,
      slug,
      content,
      excerpt,
      cover_image_url,
      cover_alt,
      category_id: typeof input.category_id === "string" ? input.category_id : null,
      tags: asStringArray(input.tags),
      status,
      scheduled_for: typeof input.scheduled_for === "string" ? input.scheduled_for : null,
      seo_title,
      seo_description,
      canonical_url,
      og_image_url,
      noindex: input.noindex === true,
      author_name: asString(input.author_name, 80) ?? "HomeScope Team",
    },
  };
}

async function slugExists(slug: string, exceptId?: string): Promise<boolean> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/articles`);
  url.searchParams.set("slug", `eq.${slug}`);
  url.searchParams.set("select", "id");
  const res = await fetch(url.toString(), { headers: authHeader() });
  if (!res.ok) return false;
  const rows = (await res.json()) as Array<{ id: string }>;
  if (!rows || rows.length === 0) return false;
  if (exceptId && rows.length === 1 && rows[0].id === exceptId) return false;
  return true;
}

async function insertRedirect(oldSlug: string, newSlug: string, articleId: string) {
  if (oldSlug === newSlug) return;
  const url = new URL(`${SUPABASE_URL}/rest/v1/article_redirects`);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { ...authHeader(), Prefer: "return=minimal" },
    body: JSON.stringify({ old_slug: oldSlug, new_slug: newSlug, article_id: articleId }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.warn("insert redirect warning:", res.status, text);
  }
}

async function fetchArticle(idOrSlug: string): Promise<any | null> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/articles`);
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  url.searchParams.set(isUuid ? "id" : "slug", `eq.${idOrSlug}`);
  url.searchParams.set("select", "*");
  const res = await fetch(url.toString(), { headers: authHeader() });
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function listArticles(opts: { status?: string; limit: number; offset: number; q?: string }) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/articles`);
  url.searchParams.set("select", "id,slug,title,status,published_at,updated_at,scheduled_for,excerpt,category_id,tags,author_name");
  url.searchParams.set("order", "updated_at.desc");
  url.searchParams.set("limit", String(opts.limit));
  url.searchParams.set("offset", String(opts.offset));
  if (opts.status) url.searchParams.set("status", `eq.${opts.status}`);
  if (opts.q) url.searchParams.set("title", `ilike.*${opts.q.replace(/[%_]/g, "")}*`);
  const res = await fetch(url.toString(), { headers: authHeader() });
  if (!res.ok) return { rows: [], total: 0 };
  const rows = (await res.json()) as any[];

  const countUrl = new URL(`${SUPABASE_URL}/rest/v1/articles`);
  countUrl.searchParams.set("select", "id");
  if (opts.status) countUrl.searchParams.set("status", `eq.${opts.status}`);
  if (opts.q) countUrl.searchParams.set("title", `ilike.*${opts.q.replace(/[%_]/g, "")}*`);
  const countRes = await fetch(countUrl.toString(), {
    headers: { ...authHeader(), Prefer: "count=exact", Range: "0-0" },
  });
  const totalHeader = countRes.headers.get("content-range") || "0/0";
  const total = parseInt(totalHeader.split("/").pop() || "0", 10) || 0;
  return { rows, total };
}

async function listCategories() {
  const url = new URL(`${SUPABASE_URL}/rest/v1/article_categories`);
  url.searchParams.set("order", "sort_order.asc,name.asc");
  url.searchParams.set("select", "*");
  const res = await fetch(url.toString(), { headers: authHeader() });
  if (!res.ok) return [];
  return res.json();
}

async function upsertArticle(input: ArticleInput, user: UserPayload, isCreate: boolean) {
  const { errors, cleaned } = validateInput(input, isCreate);
  if (errors.length > 0) {
    return { status: 400, body: { error: errors.join("; ") } };
  }

  const existing = !isCreate && typeof input.id === "string" ? await fetchArticle(input.id) : null;
  if (!isCreate && !existing) {
    return { status: 404, body: { error: "Article not found" } };
  }

  // Resolve slug: explicit slug > auto from title
  let finalSlug = cleaned.slug || (cleaned.title ? slugify(cleaned.title) : "");
  if (!finalSlug) {
    return { status: 400, body: { error: "slug could not be derived from title" } };
  }

  // Ensure slug unique, fallback to suffix on collision (except own row)
  let candidate = finalSlug;
  let attempt = 0;
  while (await slugExists(candidate, existing?.id)) {
    attempt += 1;
    candidate = `${finalSlug}-${attempt + 1}`;
    if (attempt > 10) {
      return { status: 409, body: { error: "slug already exists" } };
    }
  }

  const contentHtml = renderMarkdown(cleaned.content);
  const reading = estimateReadingMinutes(cleaned.content);
  const words = wordCount(cleaned.content);

  const status = cleaned.status || existing?.status || "draft";
  let publishedAt: string | null = existing?.published_at ?? null;
  if (status === "published") {
    if (!publishedAt) publishedAt = new Date().toISOString();
    else if (existing?.status !== "published") publishedAt = new Date().toISOString();
  }
  if (status !== "scheduled") {
    cleaned.scheduled_for = null;
  }

  const payload: Record<string, unknown> = {
    slug: candidate,
    title: cleaned.title,
    excerpt: cleaned.excerpt ?? null,
    content_markdown: cleaned.content,
    content_html: contentHtml,
    cover_image_url: cleaned.cover_image_url ?? null,
    cover_alt: cleaned.cover_alt ?? null,
    category_id: cleaned.category_id,
    tags: cleaned.tags,
    status,
    published_at: publishedAt,
    scheduled_for: cleaned.scheduled_for,
    reading_time_minutes: reading,
    word_count: words,
    seo_title: cleaned.seo_title ?? null,
    seo_description: cleaned.seo_description ?? null,
    canonical_url: cleaned.canonical_url ?? null,
    og_image_url: cleaned.og_image_url ?? null,
    noindex: cleaned.noindex,
    author_name: cleaned.author_name,
    author_user_id: existing?.author_user_id ?? user.id,
  };

  let savedId: string;
  if (isCreate) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/articles`);
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { ...authHeader(), Prefer: "return=representation" },
      body: JSON.stringify({ ...payload, created_by: user.id }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { status: res.status, body: { error: text } };
    }
    const rows = await res.json();
    savedId = rows[0].id;
  } else {
    const url = new URL(`${SUPABASE_URL}/rest/v1/articles`);
    url.searchParams.set("id", `eq.${existing.id}`);
    const res = await fetch(url.toString(), {
      method: "PATCH",
      headers: { ...authHeader(), Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      return { status: res.status, body: { error: text } };
    }
    const rows = await res.json();
    savedId = rows[0].id;

    // If slug changed, record a redirect for the old one
    if (existing?.slug && existing.slug !== candidate) {
      await insertRedirect(existing.slug, candidate, savedId);
    }
  }

  const article = await fetchArticle(savedId);
  return { status: 200, body: { article } };
}

async function deleteArticle(id: string) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/articles`);
  url.searchParams.set("id", `eq.${id}`);
  const res = await fetch(url.toString(), {
    method: "DELETE",
    headers: { ...authHeader(), Prefer: "return=representation" },
  });
  if (!res.ok) {
    const text = await res.text();
    return { status: res.status, body: { error: text } };
  }
  return { status: 200, body: { ok: true } };
}

// ===== Media upload (signed URL flow) =====
async function createUploadUrl(fileName: string, contentType: string) {
  const url = new URL(`${SUPABASE_URL}/storage/v1/object/upload/sign/article-media`);
  url.searchParams.set("transform", "resize=cover,quality=80,width=1600,height=900");
  const filePath = `covers/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80)}`;
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify({ fileName: filePath, contentType }),
  });
  if (!res.ok) {
    const text = await res.text();
    return { status: res.status, body: { error: text } };
  }
  const json = await res.json();
  const publicUrl = `${SUPABASE_URL}/storage/v1/render/image/public/article-media/${filePath}`;
  return {
    status: 200,
    body: {
      signedUrl: json?.signedURL ?? json?.signed_url ?? null,
      publicUrl,
      path: filePath,
    },
  };
}

async function publishScheduledArticles() {
  // Sweep scheduled -> published if scheduled_for <= now.
  const url = new URL(`${SUPABASE_URL}/rest/v1/articles`);
  url.searchParams.set("status", "eq.scheduled");
  url.searchParams.set("scheduled_for", `lte.${new Date().toISOString()}`);
  url.searchParams.set("select", "id,published_at,status");
  const res = await fetch(url.toString(), { headers: authHeader() });
  if (!res.ok) return;
  const rows = (await res.json()) as Array<{ id: string; published_at: string | null }>;
  for (const row of rows) {
    const patchUrl = new URL(`${SUPABASE_URL}/rest/v1/articles`);
    patchUrl.searchParams.set("id", `eq.${row.id}`);
    await fetch(patchUrl.toString(), {
      method: "PATCH",
      headers: authHeader(),
      body: JSON.stringify({ status: "published", published_at: row.published_at || new Date().toISOString() }),
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader_ = req.headers.get("Authorization");
  if (!authHeader_ || !authHeader_.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "No access token provided" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const user = decodeJWT(authHeader_.replace("Bearer ", ""));
  if (!user || !(await isAdmin(user.id))) {
    return new Response(JSON.stringify({ error: "Admin access required" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Run scheduled-publish sweep opportunistically; non-blocking if it fails.
  publishScheduledArticles().catch((err) => console.warn("sweep error:", err));

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "";

  try {
    if (req.method === "GET" && action === "list") {
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const status = url.searchParams.get("status") || undefined;
      const q = url.searchParams.get("q") || undefined;
      const result = await listArticles({ status, q, limit, offset: (page - 1) * limit });
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "GET" && action === "get") {
      const idOrSlug = url.searchParams.get("id") || url.searchParams.get("slug") || "";
      if (!idOrSlug) {
        return new Response(JSON.stringify({ error: "id or slug is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const article = await fetchArticle(idOrSlug);
      if (!article) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ article }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "GET" && action === "categories") {
      const categories = await listCategories();
      return new Response(JSON.stringify({ categories }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST" && action === "create") {
      const body = (await req.json()) as ArticleInput;
      const result = await upsertArticle(body, user, true);
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if ((req.method === "PUT" || req.method === "PATCH" || req.method === "POST") && action === "update") {
      const body = (await req.json()) as ArticleInput;
      if (!body.id) {
        return new Response(JSON.stringify({ error: "id is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await upsertArticle(body, user, false);
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "DELETE" && action === "delete") {
      const id = url.searchParams.get("id") || "";
      if (!id) {
        return new Response(JSON.stringify({ error: "id is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await deleteArticle(id);
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST" && action === "upload") {
      const body = (await req.json()) as { fileName?: string; contentType?: string };
      const fileName = asString(body.fileName, 200) || "image.jpg";
      const contentType = asString(body.contentType, 80) || "image/jpeg";
      const result = await createUploadUrl(fileName, contentType);
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("articles-admin error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});