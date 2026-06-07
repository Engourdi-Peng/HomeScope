import { supabase } from './supabase';

export interface FeedbackPayload {
  analysisId?: string;
  userId?: string;
  anonymousId?: string;
  listingFingerprint?: string;
  listingAddress?: string;
  reportType?: string;
  rating: 'useful' | 'not_useful';
  reasons: string[];
  comment: string | null;
}

function getAnonymousId(): string {
  let id = localStorage.getItem('hs_anon_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('hs_anon_id', id);
  }
  return id;
}

function buildFeedbackKey(payload: FeedbackPayload): string {
  const { userId, analysisId, anonymousId, listingFingerprint, listingAddress, reportType } = payload;

  if (userId && analysisId) {
    return `user:${userId}:analysis:${analysisId}`;
  }

  if (userId && listingFingerprint) {
    return `user:${userId}:listing:${listingFingerprint}`;
  }

  const anonId = anonymousId ?? getAnonymousId();
  if (anonId && listingFingerprint) {
    return `anon:${anonId}:listing:${listingFingerprint}`;
  }

  return `fallback:${reportType || 'unknown'}:${listingFingerprint || listingAddress || Date.now()}`;
}

export async function saveFeedback(payload: FeedbackPayload): Promise<void> {
  const { analysisId, userId, anonymousId, listingFingerprint, listingAddress, reportType, rating, reasons, comment } = payload;

  const feedbackKey = buildFeedbackKey(payload);
  const effectiveAnonId = anonymousId ?? getAnonymousId();

  const row = {
    feedback_key: feedbackKey,
    analysis_id: analysisId ?? null,
    user_id: userId ?? null,
    anonymous_id: effectiveAnonId,
    listing_fingerprint: listingFingerprint ?? null,
    listing_address: listingAddress ?? null,
    report_type: reportType ?? null,
    rating,
    reasons,
    comment: comment ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('report_feedback')
    .upsert(row, {
      onConflict: 'feedback_key',
      ignoreDuplicates: false,
    });

  if (error) throw error;
}
