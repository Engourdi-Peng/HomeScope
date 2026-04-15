import React from 'react';
import { useAppState } from '../store';
import type { ListingData, ListingDataV2 } from '../types';

function ListingCoverPlaceholderIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={37.749}
      height={26.598}
      viewBox="0 0 37.749 26.598"
      aria-hidden
    >
      <path
        fill="#e4e3e1"
        d="M898.351-97.643V-71.05h9.227V-89.8l4.956,4.956V-71.05h9.289V-89.8l4.956,4.956V-71.05H936.1V-89.8l-8.043-7.848-7.442,6.5-6.486-6.5-6.547,5.4v-5.4Z"
        transform="translate(-898.351 97.648)"
      />
    </svg>
  );
}

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

  const isV2Data = isV2(listingData);

  const rawTitle = isV2Data
    ? (listingData as ListingDataV2).title || null
    : (listingData as ListingData).address?.full || null;

  const rawAddress = isV2Data
    ? (listingData as ListingDataV2).address || null
    : null;

  // Deduplicate: address shows only if it differs meaningfully from title
  const titleToShow = rawTitle || rawAddress || 'Property';
  const addressToShow =
    rawAddress &&
    rawTitle !== rawAddress &&
    !(rawTitle && rawAddress && rawTitle.toLowerCase().includes(rawAddress.toLowerCase())) &&
    rawAddress.length > 4
      ? rawAddress
      : null;

  const priceDisplay = isV2Data
    ? (listingData as ListingDataV2).price ||
      (listingData as ListingDataV2 & { priceText?: string }).priceText ||
      'Price not available'
    : (listingData as ListingData).price?.display || 'Price not available';

  const bedrooms = isV2Data ? (listingData as ListingDataV2).bedrooms : (listingData as ListingData).property?.bedrooms;
  const bathrooms = isV2Data ? (listingData as ListingDataV2).bathrooms : (listingData as ListingData).property?.bathrooms;
  const parking = isV2Data ? (listingData as ListingDataV2).parking : (listingData as ListingData).property?.parking;

  const images = isV2Data
    ? (listingData as ListingDataV2).imageUrls
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
            <ListingCoverPlaceholderIcon />
          </div>
        )}
        <div className="ext-listing-info">
          <div className="ext-listing-title" title={titleToShow}>{titleToShow}</div>
          {addressToShow && (
            <div className="ext-listing-address-bold" title={addressToShow}>{addressToShow}</div>
          )}
        </div>
      </div>
    </div>
  );
}
