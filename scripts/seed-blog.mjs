#!/usr/bin/env node
/**
 * 灌入示例文章和分类种子数据。
 *
 * 用法：
 *   node scripts/seed-blog.mjs <SUPABASE_URL> <ACCESS_TOKEN>
 *
 * 获取 access token：在浏览器登录 HomeScope 管理员账号后，从 Supabase 客户端
 * 控制台读取 `session.access_token`（JWT）。或者使用
 * `supabase auth admin` 临时签发。
 *
 * 灌入成功后请立即 review 一遍，把示例 article 状态调整为 draft / 调整内容，
 * 然后再正式发布，避免泄露。
 */

const SUPABASE_URL = process.argv[2] || process.env.SUPABASE_URL;
const ACCESS_TOKEN = process.argv[3] || process.env.ACCESS_TOKEN;
if (!SUPABASE_URL || !ACCESS_TOKEN) {
  console.error('Usage: node scripts/seed-blog.mjs <SUPABASE_URL> <ACCESS_TOKEN>');
  process.exit(1);
}

const ADMIN_FN = `${SUPABASE_URL}/functions/v1/articles-admin`;

async function call(action, body, method = 'POST') {
  const url = new URL(ADMIN_FN);
  url.searchParams.set('action', action);
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[${action}] failed ${res.status}: ${text}`);
    return null;
  }
  try { return JSON.parse(text); } catch { return text; }
}

const CATEGORIES = [
  { slug: 'listing-review', name: 'Listing Review', description: 'How to read property listings critically before you tour.' },
  { slug: 'buying-renting', name: 'Buying & Renting Decisions', description: 'Practical decision guides for tenants and buyers.' },
  { slug: 'platform-tips', name: 'Platform Tips', description: 'Real-world tips for Zillow and realestate.com.au.' },
];

const ARTICLES = [
  {
    slug: 'how-to-review-a-zillow-listing-before-booking-a-showing',
    title: 'How to Review a Zillow Listing Before Booking a Showing',
    excerpt: 'A step-by-step walk-through of the questions to ask about photos, price signals, and missing details before you spend an afternoon touring a home.',
    tags: ['zillow', 'listing-review', 'buyer-tips'],
    category_slug: 'listing-review',
    seo_title: 'How to Review a Zillow Listing Before Booking a Showing (2026)',
    seo_description: 'A buyer-focused checklist for reviewing Zillow listings — photos, price, missing info, and questions to ask before you book a showing.',
    status: 'published',
    published_at: new Date(Date.now() - 86400000 * 21).toISOString(),
    cover_alt: 'Buyer reviewing a property listing on a laptop',
    content_markdown: `# How to Review a Zillow Listing Before Booking a Showing

Buying a home is a multi-thousand-dollar decision. Spending 30 minutes on a critical review of the Zillow listing saves you from driving across town to a property that was never a real candidate.

## 1. Open the listing and screenshot everything

Save the URL, capture the photos, and write down the asking price. You want a paper trail so you can compare it to other listings and to the agent's claims during the showing.

## 2. Check the price signal

- Look at the **price history**. A series of small drops often signals an unmotivated seller.
- Compare against nearby sales. Zillow's *Zestimate* is a starting point, not a verdict.
- Note the property tax figure — the listing price excludes carrying costs.

## 3. Read the photo set like a condition report

- Missing bathroom photos = a problem in the bathroom.
- Wide-angle shots hide small rooms. Ask for a second opinion.
- Look for dated fixtures, single-room renovations, or staged photo angles.

## 4. Spot the hidden risks

- No basement or roof photo? Assume the worst and ask.
- New roof or HVAC listed without permits? Verify.
- "Cash only" or "as-is" usually means a discount for risk.

## 5. Run a HomeScope report

HomeScope pulls the same listing into a structured report and calls out missing fields, weak evidence, and price concerns in seconds. Use it as your second pass before you message the agent.

> Tip: share the report link with your partner or co-buyer so you're aligned on the same day.

## 6. Write your showings list

After reviewing, write down three things you want to verify in person: layout, natural light, and noise. Anything HomeScope flagged as missing should be on this list.
`,
  },
  {
    slug: 'questions-to-ask-the-agent-on-a-rental-showing',
    title: 'Questions to Ask the Agent on a Rental Showing',
    excerpt: 'Eleven targeted questions that reveal lease traps, building condition, and hidden costs before you sign a rental application.',
    tags: ['rental', 'buyer-tips', 'realestate.com.au'],
    category_slug: 'buying-renting',
    seo_title: 'Questions to Ask the Agent on a Rental Showing (Australia & US)',
    seo_description: 'Eleven targeted questions to ask on a rental showing — from lease traps and utility costs to building condition and neighbor noise.',
    status: 'published',
    published_at: new Date(Date.now() - 86400000 * 14).toISOString(),
    cover_alt: 'Notebook and keys during a rental viewing',
    content_markdown: `# Questions to Ask the Agent on a Rental Showing

A rental listing rarely tells the full story. The showing is your single chance to surface what's missing from the photos.

## 1. About the lease

- What is the **actual lease length** — 6 months, 12, or month-to-month after the first term?
- Are renewals automatic, or do you have to re-apply?
- What is the policy on breaking the lease?

## 2. About the building

- How old is the roof, and when was it last inspected?
- What heating and cooling systems are in place?
- Any planned construction, special assessments, or HOA changes?

## 3. About the cost

- What's included: water, trash, parking, internet, gas?
- What's the average utility bill for the unit?
- Are pets allowed, and what's the pet rent?

## 4. About the neighborhood

- How is the noise at 9 pm on a weekday?
- Where do residents actually park?
- Is there a nearby construction project on the books?

## 5. About move-out

- What is the move-out cleaning expectation?
- Who pays for carpet cleaning or pest treatment?
- How is the security deposit returned and documented?

## 6. The deal-breakers

If the agent dodges any of these, treat the listing as suspect. Use HomeScope to compare other listings in the same block before you apply.
`,
  },
  {
    slug: 'using-realestate-com-au-photos-to-spot-condition-red-flags',
    title: 'Using realestate.com.au Photos to Spot Condition Red Flags',
    excerpt: 'What listing photos can — and cannot — tell you about an Australian rental or sale. A buyer-side photo-reading guide.',
    tags: ['realestate.com.au', 'photos', 'au-rental'],
    category_slug: 'platform-tips',
    seo_title: 'realestate.com.au Photos: Spotting Condition Red Flags',
    seo_description: 'A buyer-focused guide to reading realestate.com.au listing photos — what missing views and dated finishes mean before you book an inspection.',
    status: 'published',
    published_at: new Date(Date.now() - 86400000 * 7).toISOString(),
    cover_alt: 'Listing photos lined up on a phone',
    content_markdown: `# Using realestate.com.au Photos to Spot Condition Red Flags

Photos lie by omission. Use this checklist before you book an inspection.

## Bathroom and kitchen

If there are no bathroom or kitchen photos, assume the worst. Listing agents photograph what sells, not what doesn't.

## Wide-angle distortion

A 16mm lens makes a small apartment look like a townhouse. Ask for a second angle before falling in love.

## Outdoor space

- Garden photos taken in early spring can hide neglected landscaping.
- Balconies photographed from one angle often hide the noisy side.

## Light and windows

- Dark interior photos = blocked light or no windows on one side.
- Skylights and solar orientation affect winter comfort dramatically.

## What photos never show

- Noise from the street
- Building smells (mould, pets, cooking)
- Building management responsiveness

When in doubt, run a HomeScope report on the listing and cross-check what the photos don't show.
`,
  },
  {
    slug: 'home-buyer-offer-checklist',
    title: 'The Home Buyer's Offer Checklist: 12 Things to Verify Before You Commit',
    excerpt: 'A printable checklist of items to confirm with your agent, lender, and inspector before submitting an offer on a home.',
    tags: ['offer', 'buyer-tips', 'checklist'],
    category_slug: 'buying-renting',
    seo_title: 'Home Buyer Offer Checklist: 12 Things to Verify Before You Commit',
    seo_description: 'Printable 12-point checklist for home buyers: items to confirm with your agent, lender, and inspector before submitting an offer.',
    status: 'draft',
    cover_alt: 'Pen and contract on a kitchen counter',
    content_markdown: `# The Home Buyer's Offer Checklist: 12 Things to Verify Before You Commit

Use this as the final pass before you sign anything.

1. **Comparable sales** within 0.5 km in the last 90 days.
2. **Days on market** — confirm it's not stale.
3. **Listing history** — withdrawn or relisted?
4. **Seller disclosures** — flood, foundation, mould.
5. **Inspection contingency** window.
6. **Appraisal contingency** window.
7. **Financing type and rate lock** — locked for how long?
8. **Earnest money** amount and refundability.
9. **Closing costs** estimate.
10. **HOA fees and rules** (if applicable).
11. **Local tax rate** and projected monthly cost.
12. **Title and survey** — who pays for what?

If any answer is missing, slow down. HomeScope helps you produce a structured report from the listing itself; bring it to the agent.
`,
  },
];

async function main() {
  console.log('Seeding categories...');
  const catMap = {};
  // The admin function does not provide an upsert for categories yet; we add categories via raw SQL or via article input.
  // For seeding simplicity, we accept that categories may already exist; we only need the IDs for articles.
  const catRes = await fetch(`${SUPABASE_URL}/functions/v1/articles-public?action=categories`);
  if (catRes.ok) {
    const data = await catRes.json();
    for (const c of data.categories || []) catMap[c.slug] = c.id;
  }
  console.log('Existing categories:', catMap);

  for (const article of ARTICLES) {
    const categoryId = catMap[article.category_slug] || null;
    const payload = {
      title: article.title,
      slug: article.slug,
      excerpt: article.excerpt,
      content_markdown: article.content_markdown,
      tags: article.tags,
      category_id: categoryId,
      seo_title: article.seo_title,
      seo_description: article.seo_description,
      status: article.status,
      published_at: article.published_at,
      cover_alt: article.cover_alt,
      author_name: 'HomeScope Team',
    };
    const result = await call('create', payload);
    console.log(`Created ${article.slug}: ${result ? 'ok' : 'failed'}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});