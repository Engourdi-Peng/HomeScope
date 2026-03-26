import React from 'react';
import { Home } from 'lucide-react';
import { useAppState } from '../store';
import type { ListingData, ListingDataV2 } from '../types';

function isV2(data: ListingData | ListingDataV2 | null): data is ListingDataV2 {
  return data !== null && 'source' in data;
}

export function ListingSummary() {
  const { listingData, propertyStatus } = useAppState();

  if (propertyStatus !== 'detected' || !listingData) {
    return (
      <div className="ext-panel ext-listing-skeleton">
        <div className="ext-skeleton" style={{ height: 72, borderRadius: 10 }} />
      </div>
    );
  }

  const title = isV2(listingData)
    ? listingData.title || listingData.address || 'Property'
    : (listingData as ListingData).address?.full || 'Property';

  const priceDisplay = isV2(listingData)
    ? listingData.price ||
      (listingData as ListingDataV2 & { priceText?: string }).priceText ||
      'Price not available'
    : (listingData as ListingData).price?.display || 'Price not available';

  const bedrooms = isV2(listingData) ? listingData.bedrooms : (listingData as ListingData).property?.bedrooms;
  const bathrooms = isV2(listingData) ? listingData.bathrooms : (listingData as ListingData).property?.bathrooms;
  const parking = isV2(listingData) ? listingData.parking : (listingData as ListingData).property?.parking;

  const images = isV2(listingData)
    ? listingData.imageUrls
    : (listingData as ListingData).images;

  const imageCount = images?.length || 0;

  return (
    <div className="ext-panel">
      <div className="ext-listing">
        {imageCount > 0 ? (
          <div className="ext-listing-gallery">
            <div className="ext-listing-gallery-scroll">
              {images.map((url, idx) => (
                <img
                  key={idx}
                  src={url}
                  alt={`Photo ${idx + 1}`}
                  className="ext-listing-thumb"
                  loading="lazy"
                />
              ))}
            </div>
            <div className="ext-listing-gallery-footer">
              <span className="ext-listing-img-count">
                {imageCount} {imageCount !== 1 ? 'photos' : 'photo'}
              </span>
            </div>
          </div>
        ) : (
          <div className="ext-listing-cover-placeholder" style={{ height: 72 }}>
            <Home size={24} strokeWidth={1.5} />
          </div>
        )}
        <div className="ext-listing-info">
          <div className="ext-listing-title" title={title}>{title}</div>
          <div className="ext-listing-price">{priceDisplay}</div>
          <div className="ext-listing-meta">
            {bedrooms && (
              <span className="ext-listing-meta-item">
                <span>{bedrooms} bed</span>
              </span>
            )}
            {bathrooms && (
              <span className="ext-listing-meta-item">
                <span>{bathrooms} bath</span>
              </span>
            )}
            {parking && (
              <span className="ext-listing-meta-item">
                <span>{parking} car</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
