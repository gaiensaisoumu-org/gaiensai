import { GoHeart, GoHeartFill } from 'react-icons/go';
import { useEffect, useState } from 'preact/hooks';
import { getKnownLikeCount, type LikeType, useLikedPerformances } from './likes';
import styles from './LikeButton.module.css';

const LikeButton = ({ type, id, likeCount = 0, overlay = true }: { type: LikeType; id: number; likeCount?: number; overlay?: boolean }) => {
  const { likes, toggle, isLikeCountsLoaded } = useLikedPerformances();
  const [count, setCount] = useState(likeCount);
  const [busy, setBusy] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const liked = likes.some((like) => like.type === type && like.id === id);
  useEffect(() => setCount(getKnownLikeCount(type, id, likeCount)), [likes, type, id, likeCount]);
  const handleClick = async (event: MouseEvent) => {
    event.preventDefault(); event.stopPropagation();
    if (busy) return;
    setBusy(true);
    const result = await toggle(type, id);
    setBusy(false);
    if (result?.limitReached) { window.alert('いいねできる公演は10件までです'); return; }
    if (result) {
      setCount(result.likeCount);
      setIsAnimating(false);
      window.requestAnimationFrame(() => setIsAnimating(true));
      window.setTimeout(() => setIsAnimating(false), 420);
    }
  };
  return <button type='button' className={`${styles.button} ${overlay ? styles.overlay : ''} ${liked ? styles.liked : ''} ${isAnimating ? styles.pop : ''}`} onClick={handleClick} disabled={busy} aria-label={liked ? 'いいねを解除' : 'いいね'}>{liked ? <GoHeartFill /> : <GoHeart />}{isLikeCountsLoaded && <span>{count}</span>}</button>;
};
export default LikeButton;
