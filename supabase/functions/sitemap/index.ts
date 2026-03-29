// Supabase Edge Function - Sitemap Generator
// Deploy with: npx supabase functions deploy sitemap

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get(name: string): string | undefined;
  };
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") || "https://www.tryhomescope.com";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

/**
 * Generate XML sitemap for public analyses.
 * Uses service role key to bypass RLS — only SELECT is performed (read-only).
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ message: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // Build request to the REST API with service role key (bypasses RLS)
    const query = new URL(`${SUPABASE_URL}/rest/v1/analyses`);
    query.searchParams.set("is_public", "eq.true");
    query.searchParams.set("share_slug", "not.is.null");
    query.searchParams.set("select", "share_slug,shared_at,updated_at");

    const response = await fetch(query.toString(), {
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      console.error("Failed to fetch analyses:", response.status, body);
      throw new Error(`Failed to fetch public analyses: ${response.status}`);
    }

    type SitemapRow = {
      share_slug: string;
      shared_at?: string | null;
      updated_at?: string | null;
    };

    const analyses = await response.json() as SitemapRow[];

    function rowTimestampMs(row: SitemapRow): number {
      const raw = row.shared_at ?? row.updated_at;
      if (!raw) return 0;
      const ms = new Date(raw).getTime();
      return Number.isFinite(ms) ? ms : 0;
    }

    // Deduplicate by share_slug: keep the row with the latest shared_at or updated_at.
    const latestBySlug = new Map<string, SitemapRow>();
    for (const row of analyses) {
      if (!row.share_slug) continue;
      const prev = latestBySlug.get(row.share_slug);
      if (!prev || rowTimestampMs(row) > rowTimestampMs(prev)) {
        latestBySlug.set(row.share_slug, row);
      }
    }

    // Static pages
    const staticUrls = [
      { loc: `${SITE_URL}/`, changefreq: "weekly", priority: "1.0" },
    ];

    // Share pages (deduplicated by slug, keep latest by shared_at or updated_at)
    const shareUrls = [...latestBySlug.values()].map((row) => {
      const lastmod = row.shared_at
        ? new Date(row.shared_at).toISOString().split("T")[0]
        : row.updated_at
          ? new Date(row.updated_at).toISOString().split("T")[0]
          : new Date().toISOString().split("T")[0];
      return {
        loc: `${SITE_URL}/share/${encodeURIComponent(row.share_slug)}`,
        lastmod,
        changefreq: "weekly",
        priority: "0.8",
      };
    });

    // Build XML lines
    const lines: string[] = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ];

    for (const page of staticUrls) {
      lines.push(`  <!-- home -->`);
      lines.push(`  <url>`);
      lines.push(`    <loc>${page.loc}</loc>`);
      lines.push(`    <changefreq>${page.changefreq}</changefreq>`);
      lines.push(`    <priority>${page.priority}</priority>`);
      lines.push(`  </url>`);
    }

    for (const page of shareUrls) {
      lines.push(`  <!-- share -->`);
      lines.push(`  <url>`);
      lines.push(`    <loc>${page.loc}</loc>`);
      lines.push(`    <lastmod>${page.lastmod}</lastmod>`);
      lines.push(`    <changefreq>${page.changefreq}</changefreq>`);
      lines.push(`    <priority>${page.priority}</priority>`);
      lines.push(`  </url>`);
    }

    lines.push(`</urlset>`);

    return new Response(lines.join("\n"), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    console.error("Error generating sitemap:", err);
    return new Response(
      JSON.stringify({ message: "Failed to generate sitemap" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
