import type { ListingInfo } from '../../types';

interface ListingHeaderProps {
  listing: ListingInfo;
}

/**
 * 房源简要信息区块
 * 放置在报告最顶部，让用户第一眼就知道这份报告对应的是哪套房源
 */
export function ListingHeader({ listing }: ListingHeaderProps) {
  // 计算标题：优先用 title，没有就用地址第一行
  const title = listing.title || listing.address?.split(',')[0] || null;

  // 计算副标题：地址（与标题不重复的部分）
  const addressSubtitle = (() => {
    if (!listing.address) return null;
    if (!title) return listing.address;
    // 如果地址包含标题，去掉重复部分
    if (listing.address.toLowerCase().includes(title.toLowerCase())) {
      return listing.address.replace(new RegExp(`^${title},?\\s*`, 'i'), '').trim() || null;
    }
    return listing.address;
  })();

  // 构建 bed/bath/car 基础信息
  const buildInfoParts = () => {
    const parts: string[] = [];
    if (listing.bedrooms) parts.push(`${listing.bedrooms} bed`);
    if (listing.bathrooms) parts.push(`${listing.bathrooms} bath`);
    if (listing.parking) parts.push(`${listing.parking} car`);
    return parts;
  };
  const infoParts = buildInfoParts();

  // 如果什么都没有，直接不显示
  if (!title && !listing.price && infoParts.length === 0 && !listing.coverImageUrl) {
    return null;
  }

  return (
    <div className="mb-8 animate-in fade-in slide-in-from-bottom-6 duration-500 ease-out">
      <div className="flex gap-4 p-4 bg-white rounded-2xl border border-stone-200 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
        {/* 封面图（如果有） */}
        {listing.coverImageUrl && (
          <div className="w-20 h-20 sm:w-24 sm:h-24 shrink-0 rounded-xl overflow-hidden bg-stone-100">
            <img
              src={listing.coverImageUrl}
              alt={title || 'Property'}
              className="w-full h-full object-cover"
              onError={(e) => {
                // 图片加载失败时隐藏
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        )}

        {/* 信息区域 */}
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
          {/* 标题 */}
          {title && (
            <h1 className="text-lg sm:text-xl font-semibold text-stone-900 truncate leading-tight">
              {title}
            </h1>
          )}

          {/* 地址副标题 */}
          {addressSubtitle && (
            <p className="text-sm text-stone-500 truncate leading-snug">
              {addressSubtitle}
            </p>
          )}

          {/* 价格和 bed/bath/car */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
            {/* 价格 */}
            {listing.price && (
              <span className="text-base font-semibold text-stone-800">
                {listing.price}
              </span>
            )}

            {/* 分隔符 */}
            {listing.price && infoParts.length > 0 && (
              <span className="text-stone-300 text-sm">·</span>
            )}

            {/* bed/bath/car */}
            {infoParts.length > 0 && (
              <span className="text-sm text-stone-600">
                {infoParts.join(' · ')}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
