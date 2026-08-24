import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SiteLayout } from '../../components/SiteLayout';
import { adminListArticles, adminDeleteArticle } from '../../lib/articles/adminClient';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  review: 'Review',
  scheduled: 'Scheduled',
  published: 'Published',
  archived: 'Archived',
};

export function AdminArticlesListPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const limit = 20;

  const load = () => {
    setLoading(true);
    setError(null);
    adminListArticles({ page, limit, status: status || undefined, q: query || undefined })
      .then((res) => {
        setRows(res.rows || []);
        setTotal(res.total || 0);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load articles'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    load();
  };

  const onDelete = async (id: string) => {
    if (!confirm('Delete this article permanently?')) return;
    try {
      await adminDeleteArticle(id);
      load();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <SiteLayout>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900">Article Admin</h1>
          <p className="text-sm text-stone-500">Manage blog posts and SEO content.</p>
        </div>
        <Link
          to="/admin/articles/new"
          className="px-4 py-2 bg-stone-900 text-white text-sm font-medium rounded-lg hover:bg-stone-800"
        >
          New article
        </Link>
      </div>

      <div className="mb-4 flex flex-col md:flex-row gap-3 md:items-center">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm"
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <form role="search" onSubmit={onSearch} className="flex-1 flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title..."
            className="flex-1 px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-stone-300"
          />
          <button type="submit" className="px-3 py-2 rounded-lg bg-stone-100 text-stone-700 text-sm">Search</button>
        </form>
      </div>

      {error && (
        <div className="p-4 mb-6 rounded-2 bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-stone-500 text-sm">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-stone-500 text-sm">No articles match the current filter.</div>
      ) : (
        <div className="overflow-x-auto bg-white rounded-2xl border border-stone-200">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-widest text-stone-500 bg-stone-50">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-stone-100">
                  <td className="px-4 py-3">
                    <div className="font-medium text-stone-900">{row.title}</div>
                    <div className="text-xs text-stone-500">/{row.slug}</div>
                  </td>
                  <td className="px-4 py-3 text-stone-700">{STATUS_LABELS[row.status] || row.status}</td>
                  <td className="px-4 py-3 text-stone-500">{new Date(row.updated_at).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/admin/articles/${row.id}/edit`} className="text-stone-700 hover:underline mr-3">Edit</Link>
                    <button type="button" onClick={() => onDelete(row.id)} className="text-red-600 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-6 flex justify-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPage(p)}
              className={`px-3 py-1.5 rounded-lg text-sm border ${
                p === page
                  ? 'bg-stone-900 text-white border-stone-900'
                  : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </SiteLayout>
  );
}

export default AdminArticlesListPage;