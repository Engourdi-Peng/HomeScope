import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { SiteLayout } from '../../components/SiteLayout';
import {
  adminCreateArticle,
  adminGetArticle,
  adminUpdateArticle,
  adminFetchCategories,
  adminUploadImage,
} from '../../lib/articles/adminClient';

interface FormState {
  title: string;
  slug: string;
  excerpt: string;
  content_markdown: string;
  cover_image_url: string;
  cover_alt: string;
  category_id: string;
  tags: string;
  status: 'draft' | 'review' | 'scheduled' | 'published' | 'archived';
  scheduled_for: string;
  seo_title: string;
  seo_description: string;
  canonical_url: string;
  og_image_url: string;
  noindex: boolean;
  author_name: string;
}

const EMPTY: FormState = {
  title: '',
  slug: '',
  excerpt: '',
  content_markdown: '',
  cover_image_url: '',
  cover_alt: '',
  category_id: '',
  tags: '',
  status: 'draft',
  scheduled_for: '',
  seo_title: '',
  seo_description: '',
  canonical_url: '',
  og_image_url: '',
  noindex: false,
  author_name: 'HomeScope Team',
};

export function AdminArticleEditorPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';
  const [form, setForm] = useState<FormState>(EMPTY);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    adminFetchCategories().then((res) => setCategories(res.categories || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (isNew) return;
    setLoading(true);
    setError(null);
    setLoadFailed(false);
    adminGetArticle(id!)
      .then((res) => {
        const a = res.article;
        setForm({
          title: a.title || '',
          slug: a.slug || '',
          excerpt: a.excerpt || '',
          content_markdown: a.content_markdown || '',
          cover_image_url: a.cover_image_url || '',
          cover_alt: a.cover_alt || '',
          category_id: a.category_id || '',
          tags: (a.tags || []).join(', '),
          status: a.status || 'draft',
          scheduled_for: a.scheduled_for || '',
          seo_title: a.seo_title || '',
          seo_description: a.seo_description || '',
          canonical_url: a.canonical_url || '',
          og_image_url: a.og_image_url || '',
          noindex: !!a.noindex,
          author_name: a.author_name || 'HomeScope Team',
        });
        setLoadFailed(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load article');
        setLoadFailed(true);
      })
      .finally(() => setLoading(false));
  }, [id, isNew]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const onCoverUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const url = await adminUploadImage(file);
      setField('cover_image_url', url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const onSave = async (status: FormState['status']) => {
    if (!isNew && loadFailed) {
      setError('Cannot save: the original article failed to load. Refresh the page and try again.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        ...form,
        status,
        tags: form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        category_id: form.category_id || null,
        scheduled_for: form.scheduled_for || null,
        noindex: form.noindex,
      };
      const result = isNew
        ? await adminCreateArticle(payload)
        : await adminUpdateArticle(id!, payload);
      navigate(`/admin/articles/${result.article.id}/edit`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SiteLayout>
        <div className="text-stone-500 text-sm">Loading article...</div>
      </SiteLayout>
    );
  }

  return (
    <SiteLayout>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-stone-900">{isNew ? 'New Article' : 'Edit Article'}</h1>
        <Link to="/admin/articles" className="text-sm text-stone-600 hover:underline">Back to list</Link>
      </div>

      {error && (
        <div className="p-4 mb-6 rounded-2 bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
      )}

      <div className="grid lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-4">
          <Field label="Title">
            <input
              type="text"
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm"
              placeholder="Headline that explains the article's value"
            />
          </Field>

          <Field label="Slug" hint="Leave blank to auto-generate from title. Lowercase letters, numbers and hyphens only.">
            <input
              type="text"
              value={form.slug}
              onChange={(e) => setField('slug', e.target.value.toLowerCase())}
              className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm"
              placeholder="auto-generated"
            />
          </Field>

          <Field label="Excerpt" hint="1–2 sentences; appears in lists and social cards.">
            <textarea
              value={form.excerpt}
              onChange={(e) => setField('excerpt', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm"
            />
          </Field>

          <Field label="Content (Markdown)">
            <textarea
              value={form.content_markdown}
              onChange={(e) => setField('content_markdown', e.target.value)}
              rows={20}
              className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm font-mono"
              placeholder="# Headline&#10;&#10;Write the article body using Markdown."
            />
          </Field>
        </div>

        <aside className="space-y-4">
          <Section title="Publishing">
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => setField('status', e.target.value as FormState['status'])}
                className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm"
              >
                <option value="draft">Draft</option>
                <option value="review">Review</option>
                <option value="scheduled">Scheduled</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
            {form.status === 'scheduled' && (
              <Field label="Scheduled for (UTC ISO)">
                <input
                  type="text"
                  value={form.scheduled_for}
                  onChange={(e) => setField('scheduled_for', e.target.value)}
                  placeholder="2026-09-01T08:00:00Z"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm"
                />
              </Field>
            )}
            <Field label="Author">
              <input
                type="text"
                value={form.author_name}
                onChange={(e) => setField('author_name', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm"
              />
            </Field>
          </Section>

          <Section title="Category & tags">
            <Field label="Category">
              <select
                value={form.category_id}
                onChange={(e) => setField('category_id', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm"
              >
                <option value="">Uncategorised</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Tags" hint="Comma separated. Lowercase, e.g. zillow, rental, buyer-tips">
              <input
                type="text"
                value={form.tags}
                onChange={(e) => setField('tags', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm"
              />
            </Field>
          </Section>

          <Section title="Cover image">
            {form.cover_image_url ? (
              <img src={form.cover_image_url} alt={form.cover_alt || form.title || 'cover'} className="w-full aspect-[16/9] object-cover rounded-xl mb-3" />
            ) : null}
            <label className="block">
              <span className="sr-only">Upload cover image</span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => e.target.files?.[0] && onCoverUpload(e.target.files[0])}
                className="block w-full text-sm"
              />
            </label>
            {uploading && <p className="text-xs text-stone-500 mt-2">Uploading…</p>}
            <Field label="Cover alt text">
              <input
                type="text"
                value={form.cover_alt}
                onChange={(e) => setField('cover_alt', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm"
              />
            </Field>
          </Section>

          <Section title="SEO">
            <Field label="SEO title" hint="50–70 characters recommended">
              <input
                type="text"
                value={form.seo_title}
                onChange={(e) => setField('seo_title', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm"
              />
              <CharCount value={form.seo_title} max={70} />
            </Field>
            <Field label="SEO description" hint="140–200 characters recommended">
              <textarea
                value={form.seo_description}
                onChange={(e) => setField('seo_description', e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm"
              />
              <CharCount value={form.seo_description} max={200} />
            </Field>
            <Field label="Canonical URL" hint="Optional. Leave blank to default.">
              <input
                type="url"
                value={form.canonical_url}
                onChange={(e) => setField('canonical_url', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm"
              />
            </Field>
            <Field label="OG image URL" hint="Optional. Defaults to site og-default.png.">
              <input
                type="url"
                value={form.og_image_url}
                onChange={(e) => setField('og_image_url', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                checked={form.noindex}
                onChange={(e) => setField('noindex', e.target.checked)}
              />
              Mark as noindex
            </label>
          </Section>
        </aside>
      </div>

      <div className="mt-6 flex flex-wrap gap-2 sticky bottom-0 bg-white/80 backdrop-blur py-3 border-t border-stone-200">
        <button type="button" disabled={saving || loadFailed} onClick={() => onSave('draft')} className="px-4 py-2 rounded-lg bg-stone-100 text-stone-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed">Save draft</button>
        <button type="button" disabled={saving || loadFailed} onClick={() => onSave('review')} className="px-4 py-2 rounded-lg bg-amber-100 text-amber-800 text-sm disabled:opacity-50 disabled:cursor-not-allowed">Send to review</button>
        <button type="button" disabled={saving || loadFailed} onClick={() => onSave('published')} className="px-4 py-2 rounded-lg bg-stone-900 text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed">Publish</button>
      </div>
    </SiteLayout>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-widest text-stone-500">{label}</span>
      {hint && <span className="block text-xs text-stone-400 mt-1">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3">
      <h2 className="text-sm font-semibold text-stone-900">{title}</h2>
      {children}
    </section>
  );
}

function CharCount({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return (
    <div className={`text-xs mt-1 ${over ? 'text-red-600' : 'text-stone-400'}`}>
      {value.length}/{max}
    </div>
  );
}

export default AdminArticleEditorPage;