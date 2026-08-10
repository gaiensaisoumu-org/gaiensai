import { useEffect, useState } from 'preact/hooks';
import { supabase } from '../../lib/supabase';

export type LikeType = 'class' | 'gym' | 'club';
export type LikedPerformance = { type: LikeType; id: number };
const STORAGE_KEY = 'likedPerformances';
const CHANGE_EVENT = 'liked-performances-changed';
const likeCounts = new Map<string, number>();
const acceptance = new Map<string, boolean>();
let likeCountsRequest: Promise<void> | null = null;
let likeCountsLoaded = false;

const readLikes = (): LikedPerformance[] => {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is LikedPerformance =>
      typeof item === 'object' && item !== null &&
      ['class', 'gym', 'club'].includes((item as LikedPerformance).type) &&
      Number.isInteger((item as LikedPerformance).id),
    );
  } catch { return []; }
};
const writeLikes = (likes: LikedPerformance[], key?: string, count?: number) => {
  if (key !== undefined && count !== undefined) likeCounts.set(key, count);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(likes));
  window.dispatchEvent(new Event(CHANGE_EVENT));
};
export const likeKey = (type: LikeType, id: number) => `${type}:${id}`;
export const getKnownLikeCount = (type: LikeType, id: number, fallback: number) =>
  likeCounts.get(likeKey(type, id)) ?? fallback;

const loadLikeCounts = async () => {
  if (likeCountsLoaded) return;
  if (!likeCountsRequest) {
    likeCountsRequest = Promise.resolve(supabase.rpc('get_public_performance_acceptance')).then(({ data, error }) => {
      if (!error && Array.isArray(data)) {
        for (const row of data as Array<{ performance_type: LikeType; performance_id: number; is_accepting: boolean | null; like_count: number }>) {
          if (['class', 'gym', 'club'].includes(row.performance_type) && Number.isInteger(row.performance_id)) {
            likeCounts.set(likeKey(row.performance_type, row.performance_id), Number(row.like_count) || 0);
            if (row.is_accepting !== null) acceptance.set(likeKey(row.performance_type, row.performance_id), row.is_accepting);
          }
        }
        likeCountsLoaded = true;
        window.dispatchEvent(new Event(CHANGE_EVENT));
      }
    }).finally(() => { likeCountsRequest = null; });
  }
  await likeCountsRequest;
};

export const useLikedPerformances = () => {
  const [likes, setLikes] = useState<LikedPerformance[]>(readLikes);
  const [isLikeCountsLoaded, setIsLikeCountsLoaded] = useState(likeCountsLoaded);
  useEffect(() => {
    const sync = () => { setLikes(readLikes()); setIsLikeCountsLoaded(likeCountsLoaded); };
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(CHANGE_EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  useEffect(() => { void loadLikeCounts(); }, []);
  const toggle = async (type: LikeType, id: number): Promise<{ liked: boolean; likeCount: number; limitReached: boolean } | null> => {
    const current = readLikes();
    const index = current.findIndex((like) => like.type === type && like.id === id);
    const liked = index >= 0;
    if (!liked && current.length >= 10) return { liked: false, likeCount: 0, limitReached: true };
    const { data, error } = await supabase.rpc('change_performance_like', { p_type: type, p_id: id, p_delta: liked ? -1 : 1 });
    if (error || typeof data !== 'number') return null;
    writeLikes(liked ? current.filter((_, currentIndex) => currentIndex !== index) : [...current, { type, id }], likeKey(type, id), data);
    return { liked: !liked, likeCount: data, limitReached: false };
  };
  return { likes, toggle, isLikeCountsLoaded, acceptance: isLikeCountsLoaded ? acceptance : null };
};
