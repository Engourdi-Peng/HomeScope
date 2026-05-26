// ── Shared Risk Badge ─────────────────────────────────────────────────────────
function RiskBadge({ level }: { level?: string }) {
  const config: Record<string, { cls: string; label: string }> = {
    Low: { cls: 'bg-green-50 text-green-700 border-green-200', label: 'LOW RISK' },
    Medium: { cls: 'bg-amber-50 text-amber-700 border-amber-200', label: 'MEDIUM RISK' },
    High: { cls: 'bg-red-50 text-red-700 border-red-200', label: 'HIGH RISK' },
    Unknown: { cls: 'bg-stone-50 text-stone-600 border-stone-300', label: 'NEEDS VERIFICATION' },
  };
  const c = config[level || 'Unknown'] || config.Unknown;
  return (
    <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded border ${c.cls}`}>
      {c.label}
    </span>
  );
}

export { RiskBadge };
