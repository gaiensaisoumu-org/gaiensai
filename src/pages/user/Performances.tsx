import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { useTitle } from '../../hooks/useTitle';
import performancesSnapshot from '../../generated/performances-static.json';
import { getPerformanceImageUrl } from '../../lib/supabase';
import baseStyles from '../../styles/sub-pages.module.css';
import styles from './Performances.module.css';
import ticketStyles from '../../features/tickets/IssuedTicketCardList.module.css';
import NormalSection from '../../components/ui/NormalSection';
import Modal2 from '../../components/ui/Modal2';
import LikeButton from '../../features/performances/LikeButton';
import {
  getKnownLikeCount,
  useLikedPerformances,
} from '../../features/performances/likes';

interface ClassPerformance {
  id: number; // smallint
  year: number | null; // smallint
  class_name: string | null; // text
  title: string | null; // text
  description: string | null; // text
  created_at: string; // timestamptz
  junior_capacity: number | null; // smallint
  total_capacity: number | null; // smallint
  is_accepting: boolean | null; // boolean
  image_path: string | null;
  like?: number;
}

interface GymPerformance {
  id: number;
  group_name: string;
  round_name: string;
  start_at: string; // timestamptz
  end_at: string; // timestamptz
  capacity: number;
  junior_capacity: number | null;
  year: number;
  is_accepting: boolean | null;
  description: string | null;
  image_path: string | null;
  like?: number;
}

interface ExhibitionClub {
  id: number;
  year: number | null;
  group_name: string;
  description: string | null;
  image_path: string | null;
  created_at: string;
  like?: number;
  location?: string | null;
}

type PerformanceSnapshot = {
  generatedAt?: string;
  performances?: ClassPerformance[];
  gymPerformances?: GymPerformance[];
  exhibitionClubs?: ExhibitionClub[];
};

const snapshot = performancesSnapshot as unknown as PerformanceSnapshot;

const DescriptionPreview = ({
  description,
  href,
}: {
  description: string;
  href: string;
}) => {
  const ref = useRef<HTMLParagraphElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const check = () =>
      setIsTruncated(element.scrollHeight > element.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [description]);
  return (
    <>
      <p
        ref={ref}
        className={`${styles.description} ${styles.clampedDescription}`}
      >
        {description}
      </p>
      {isTruncated && (
        <a
          className={styles.readMore}
          href={href}
          onClick={(event) => event.stopPropagation()}
        >
          続きを読む
        </a>
      )}
    </>
  );
};

const Performances = () => {
  const { route } = useLocation();
  const { likes, acceptance } = useLikedPerformances();
  const [classSortMode, setClassSortMode] = useState<'class' | 'likes'>(() =>
    window.localStorage.getItem('performances.classSortMode') === 'likes'
      ? 'likes'
      : 'class',
  );
  const [gymSortMode, setGymSortMode] = useState<'name' | 'likes'>(() =>
    window.localStorage.getItem('performances.gymSortMode') === 'likes'
      ? 'likes'
      : 'name',
  );
  const [clubSortMode, setClubSortMode] = useState<'name' | 'likes'>(() =>
    window.localStorage.getItem('performances.clubSortMode') === 'likes'
      ? 'likes'
      : 'name',
  );
  useEffect(() => {
    window.localStorage.setItem('performances.classSortMode', classSortMode);
  }, [classSortMode]);
  useEffect(() => {
    window.localStorage.setItem('performances.gymSortMode', gymSortMode);
  }, [gymSortMode]);
  useEffect(() => {
    window.localStorage.setItem('performances.clubSortMode', clubSortMode);
  }, [clubSortMode]);
  useTitle('公演一覧');
  const classData = useMemo(() => snapshot.performances ?? [], []);
  const gymData = useMemo(() => {
    // 【重複除去ロジック】
    // group_nameごとに最初に出現した要素（IDが最も小さいもの）だけを配列に残します
    const uniqueGroupPerformances: GymPerformance[] = [];
    const seenGroups = new Set<string>();

    for (const item of [...(snapshot.gymPerformances ?? [])]) {
      if (!seenGroups.has(item.group_name)) {
        seenGroups.add(item.group_name);
        uniqueGroupPerformances.push(item);
      }
    }
    uniqueGroupPerformances.sort(
      (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
    );
    return uniqueGroupPerformances;
  }, []);
  const exhibitionData = useMemo(() => snapshot.exhibitionClubs ?? [], []);
  const likedCards = useMemo(
    () =>
      likes
        .map((like) => {
          if (like.type === 'class') {
            const item = classData.find(
              (performance) => performance.id === like.id,
            );
            return item
              ? {
                  ...like,
                  title: item.title || item.class_name || '無題の公演',
                  imagePath: item.image_path,
                  count: item.like ?? 0,
                  href: `/performances/class/${item.id}`,
                }
              : null;
          }
          if (like.type === 'gym') {
            const item = gymData.find(
              (performance) => performance.id === like.id,
            );
            return item
              ? {
                  ...like,
                  title: item.group_name,
                  imagePath: item.image_path,
                  count: item.like ?? 0,
                  href: `/performances/gym/${item.id}`,
                }
              : null;
          }
          const item = exhibitionData.find((club) => club.id === like.id);
          return item
            ? {
                ...like,
                title: item.group_name,
                imagePath: item.image_path,
                count: item.like ?? 0,
                href: `/performances/club/${item.id}`,
              }
            : null;
        })
        .filter(
          (
            item,
          ): item is {
            type: 'class' | 'gym' | 'club';
            id: number;
            title: string;
            imagePath: string | null;
            count: number;
            href: string;
          } => item !== null,
        ),
    [likes, classData, gymData, exhibitionData],
  );
  const isGymGroupAccepting = (groupName: string) =>
    (snapshot.gymPerformances ?? []).some(
      (performance) =>
        performance.group_name === groupName &&
        acceptance?.get(`gym:${performance.id}`) === true,
    );
  const sortedClassData = useMemo(
    () =>
      [...classData].sort((a, b) => {
        const classOrder = (a.class_name ?? '').localeCompare(
          b.class_name ?? '',
          'ja',
          { numeric: true },
        );
        if (classSortMode === 'class') {
          return classOrder;
        }
        return (
          getKnownLikeCount('class', b.id, b.like ?? 0) -
            getKnownLikeCount('class', a.id, a.like ?? 0) || classOrder
        );
      }),
    [classData, classSortMode, likes],
  );
  const sortedGymData = useMemo(
    () =>
      [...gymData].sort((a, b) =>
        gymSortMode === 'name'
          ? a.group_name.localeCompare(b.group_name, 'ja')
          : getKnownLikeCount('gym', b.id, b.like ?? 0) -
              getKnownLikeCount('gym', a.id, a.like ?? 0) ||
            a.group_name.localeCompare(b.group_name, 'ja'),
      ),
    [gymData, gymSortMode, likes],
  );
  const sortedExhibitionData = useMemo(
    () =>
      [...exhibitionData].sort((a, b) =>
        clubSortMode === 'name'
          ? a.group_name.localeCompare(b.group_name, 'ja')
          : getKnownLikeCount('club', b.id, b.like ?? 0) -
              getKnownLikeCount('club', a.id, a.like ?? 0) ||
            a.group_name.localeCompare(b.group_name, 'ja'),
      ),
    [exhibitionData, clubSortMode, likes],
  );

  return (
    <>
      <Modal2 />
      <h1 className={baseStyles.pageTitle}>公演一覧</h1>
      {likedCards.length > 0 && (
        <section>
          <h2 className={baseStyles.linedH2}>いいねした公演</h2>
          <div className={styles.grid}>
            {likedCards.map((performance) => (
              <NormalSection
                key={`${performance.type}:${performance.id}`}
                className={`${styles.card} ${performance.href ? styles.cardLink : ''}`}
                onClick={() => performance.href && route(performance.href)}
              >
                <div className={styles.cardHeader}>
                  {performance.imagePath && (
                    <img
                      src={getPerformanceImageUrl(
                        performance.imagePath,
                        snapshot.generatedAt,
                      )}
                      alt={performance.title}
                      className={styles.cardBgImage}
                      loading='lazy'
                    />
                  )}
                  <div className={styles.overlay} />
                  <div className={styles.headerContent}>
                    <h3 className={styles.cardTitle}>{performance.title}</h3>
                  </div>
                  <LikeButton
                    type={performance.type}
                    id={performance.id}
                    likeCount={performance.count}
                  />
                </div>
              </NormalSection>
            ))}
          </div>
        </section>
      )}
      <section>
        <h2 className={baseStyles.linedH2}>クラス公演</h2>
        <div className={ticketStyles.sortControlRow}>
          <label className={ticketStyles.sortLabel}>並び順</label>
          <select
            className={ticketStyles.sortSelect}
            value={classSortMode}
            onChange={(event) =>
              setClassSortMode(
                event.currentTarget.value === 'likes' ? 'likes' : 'class',
              )
            }
          >
            <option value='class'>クラス順</option>
            <option value='likes'>いいね順</option>
          </select>
        </div>
        <div className={styles.grid}>
          {sortedClassData.length === 0 ? (
            <div className={styles.stateMessage}>
              公開中のクラス公演はありません。
            </div>
          ) : (
            sortedClassData.map((perf) => (
              <NormalSection
                key={perf.id}
                className={`${styles.card} ${styles.cardLink}`}
                onClick={() => route(`/performances/class/${perf.id}`)}
              >
                <div className={styles.cardHeader}>
                  {perf.image_path && (
                    <>
                      {/* 背景画像（すべて表示） */}
                      <img
                        src={getPerformanceImageUrl(
                          perf.image_path,
                          snapshot.generatedAt,
                        )}
                        alt={perf.title || '公演画像'}
                        className={styles.cardBgImage}
                        loading='lazy'
                      />
                      {/* グラデーション暗幕 */}
                      <div className={styles.overlay} />
                    </>
                  )}
                  {/* 前面のテキスト情報 */}
                  <div
                    className={`${styles.headerContent} ${!perf.image_path ? styles.noImage : ''}`}
                  >
                    <div className={styles.headerMetaData}>
                      <div>
                        <div className={styles.meta}>
                          <span className={styles.yearBadge}>
                            {perf.year}年度
                          </span>
                          <span className={styles.className}>
                            {perf.class_name}
                          </span>
                        </div>
                      </div>
                      {acceptance !== null && (
                        <div>
                          <span
                            className={`${styles.statusBadge} ${acceptance.get(`class:${perf.id}`) ? styles.statusAccepting : styles.statusClosed}`}
                          >
                            {acceptance.get(`class:${perf.id}`)
                              ? '受付中'
                              : '受付停止中'}
                          </span>
                        </div>
                      )}
                    </div>
                    <h3 className={styles.cardTitle}>
                      {perf.title || '無題の公演'}
                    </h3>
                  </div>
                  <LikeButton
                    type='class'
                    id={perf.id}
                    likeCount={perf.like ?? 0}
                  />
                </div>

                {/* ─── 2. 画像が一切かぶらない「ボディエリア」（白背景） ─── */}
                <div className={styles.cardBody}>
                  {/* 体育館公演などの場合はここに timeBox を配置できます */}
                  {/* {perf.start_at && <div className={styles.timeBox}>...</div>} */}

                  <DescriptionPreview
                    description={perf.description || '説明はありません。'}
                    href={`/performances/class/${perf.id}`}
                  />

                  <div className={styles.footer}>
                    <div>
                      全体定員:{' '}
                      <span className={styles.capacityValue}>
                        {perf.total_capacity ?? 0}名
                      </span>
                    </div>
                    <div>
                      中学生枠:{' '}
                      <span className={styles.capacityValue}>
                        {perf.junior_capacity ?? 0}名
                      </span>
                    </div>
                  </div>
                </div>
              </NormalSection>
            ))
          )}
        </div>
      </section>
      <section>
        <h2 className={baseStyles.linedH2}>体育館公演</h2>
        <div className={ticketStyles.sortControlRow}>
          <label className={ticketStyles.sortLabel}>
            並び順{' '}
            <select
              className={ticketStyles.sortSelect}
              value={gymSortMode}
              onChange={(event) =>
                setGymSortMode(
                  event.currentTarget.value === 'likes' ? 'likes' : 'name',
                )
              }
            >
              <option value='name'>団体名順</option>
              <option value='likes'>いいね順</option>
            </select>
          </label>
        </div>
        <div className={styles.grid}>
          {sortedGymData.length === 0 ? (
            <div className={styles.stateMessage}>
              公開中の体育館公演はありません。
            </div>
          ) : (
            sortedGymData.map((perf) => (
              <NormalSection
                key={perf.id}
                className={`${styles.card} ${styles.cardLink}`}
                onClick={() => route(`/performances/gym/${perf.id}`)}
              >
                {/* 📸 体育館用：背景画像を敷くヘッダーエリア（画像の高さで可変） */}
                <div className={styles.cardHeader}>
                  {perf.image_path && (
                    <>
                      {/* 背景画像（すべて表示） */}
                      <img
                        src={getPerformanceImageUrl(
                          perf.image_path,
                          snapshot.generatedAt,
                        )}
                        alt={perf.group_name || '公演画像'}
                        className={styles.cardBgImage}
                        loading='lazy'
                      />
                      {/* グラデーション暗幕 */}
                      <div className={styles.overlay} />
                    </>
                  )}
                  {/* 画像のボトムに固定される文字コンテンツ */}
                  <div
                    className={`${styles.headerContent} ${!perf.image_path ? styles.noImage : ''}`}
                  >
                    <div className={styles.headerMetaData}>
                      <div>
                        <div className={styles.meta}>
                          <span className={styles.yearBadge}>
                            {perf.year}年度
                          </span>
                        </div>
                      </div>
                      {acceptance !== null && (
                        <div>
                          <span
                            className={`${styles.statusBadge} ${isGymGroupAccepting(perf.group_name) ? styles.statusAccepting : styles.statusClosed}`}
                          >
                            {isGymGroupAccepting(perf.group_name)
                              ? '受付中'
                              : '受付停止中'}
                          </span>
                        </div>
                      )}
                    </div>
                    <h3 className={styles.cardTitle}>{perf.group_name}</h3>
                  </div>
                  <LikeButton
                    type='gym'
                    id={perf.id}
                    likeCount={perf.like ?? 0}
                  />
                </div>

                {/* 📄 体育館用：画像がかぶらない白背景エリア（高さ自動調整） */}
                <div className={styles.cardBody}>
                  <DescriptionPreview
                    description={perf.description || '公演説明はありません。'}
                    href={`/performances/gym/${perf.id}`}
                  />

                  <div className={styles.footer}>
                    <div>
                      定員:{' '}
                      <span className={styles.capacityValue}>
                        {perf.capacity}名
                      </span>
                    </div>
                    <div>
                      中学生枠:{' '}
                      <span className={styles.capacityValue}>
                        {perf.junior_capacity ?? 0}名
                      </span>
                    </div>
                  </div>
                </div>
              </NormalSection>
            ))
          )}
        </div>
      </section>
      <section>
        <h2 className={baseStyles.linedH2}>展示部活</h2>
        <div className={ticketStyles.sortControlRow}>
          <label className={ticketStyles.sortLabel}>
            並び順{' '}
            <select
              className={ticketStyles.sortSelect}
              value={clubSortMode}
              onChange={(event) =>
                setClubSortMode(
                  event.currentTarget.value === 'likes' ? 'likes' : 'name',
                )
              }
            >
              <option value='name'>団体名順</option>
              <option value='likes'>いいね順</option>
            </select>
          </label>
        </div>
        <div className={styles.grid}>
          {sortedExhibitionData.length === 0 ? (
            <div className={styles.stateMessage}>
              公開中の展示部活はありません。
            </div>
          ) : (
            sortedExhibitionData.map((club) => (
              <NormalSection
                key={club.id}
                className={`${styles.card} ${styles.cardLink}`}
                onClick={() => route(`/performances/club/${club.id}`)}
              >
                <div className={styles.cardHeader}>
                  {club.image_path && (
                    <>
                      <img
                        src={getPerformanceImageUrl(
                          club.image_path,
                          snapshot.generatedAt,
                        )}
                        alt={club.group_name}
                        className={styles.cardBgImage}
                        loading='lazy'
                      />
                      <div className={styles.overlay} />
                    </>
                  )}
                  <div
                    className={`${styles.headerContent} ${!club.image_path ? styles.noImage : ''}`}
                  >
                    <div className={styles.meta}>
                      {club.year !== null && (
                        <span className={styles.yearBadge}>
                          {club.year}年度
                        </span>
                      )}
                    </div>
                    <h3 className={styles.cardTitle}>{club.group_name}</h3>
                  </div>
                  <LikeButton
                    type='club'
                    id={club.id}
                    likeCount={club.like ?? 0}
                  />
                </div>
                <div className={styles.cardBody}>
                  <DescriptionPreview
                    description={club.description || '展示説明はありません。'}
                    href={`/performances/club/${club.id}`}
                  />
                </div>
              </NormalSection>
            ))
          )}
        </div>
      </section>
    </>
  );
};

export default Performances;
