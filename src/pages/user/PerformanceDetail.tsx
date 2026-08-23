import { useEffect, useMemo, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import {
  RiCircleLine,
  RiCloseLargeLine,
  RiInstagramLine,
  RiTiktokFill,
  RiTriangleLine,
  RiTwitterXFill,
} from 'react-icons/ri';
import { IoMdLink } from 'react-icons/io';
import performancesSnapshot from '../../generated/performances-static.json';
import BackButton from '../../components/ui/BackButton';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { useTitle } from '../../hooks/useTitle';
import { getPerformanceImageUrl, supabase } from '../../lib/supabase';
import { RESTORE_PERFORMANCE_LIST_SCROLL_KEY } from '../../utils/ScrollToTop';
import { getPerformanceAvailability } from '../../features/performances/performanceAvailability';
import {
  getAvailabilityStatus,
  getCapacityForMode,
  getClassRemaining,
  getGymRemaining,
  getPublicRemainingMode,
  type RemainingMode,
} from '../../features/performances/availabilityHelpers';
import baseStyles from '../../styles/sub-pages.module.css';
import styles from './PerformanceDetail.module.css';
import LikeButton from '../../features/performances/LikeButton';
import { useLikedPerformances } from '../../features/performances/likes';
import listStyles from './Performances.module.css';

type ClassPerformance = {
  id: number;
  class_name: string | null;
  title: string | null;
  description: string | null;
  image_path: string | null;
  gallery_paths?: string[] | null;
  external_links?: ExternalLinks | null;
  like?: number;
  total_capacity: number | null;
  junior_capacity: number | null;
};
type GymPerformance = {
  id: number;
  group_name: string;
  round_name: string;
  start_at: string;
  end_at: string;
  capacity: number;
  junior_capacity: number | null;
  description: string | null;
  image_path: string | null;
  gallery_paths?: string[] | null;
  external_links?: ExternalLinks | null;
  like?: number;
};
type ExhibitionClub = {
  id: number;
  group_name: string;
  description: string | null;
  image_path: string | null;
  gallery_paths?: string[] | null;
  external_links?: ExternalLinks | null;
  like?: number;
  location?: string | null;
};
type ExternalLinks = {
  instagram?: string;
  x?: string;
  tiktok?: string;
  others?: string[];
};
type Schedule = { id: number; round_name: string; start_at?: string | null };
type Counter = {
  class_id?: number;
  round_id?: number;
  performance_id?: number;
  issued_general?: number | null;
  issued_junior?: number | null;
  issued_other?: number | null;
};
type Availability = {
  schedules?: Array<Schedule & { is_active?: boolean }>;
  class_performances?: Array<{ id: number; is_accepting?: boolean }>;
  class_counters?: Counter[];
  gym_performances?: Array<GymPerformance & { is_accepting?: boolean }>;
  gym_counters?: Counter[];
  config?: { junior_release_open?: boolean | null };
};
type Snapshot = {
  generatedAt?: string;
  showLengthMinutes?: number;
  performances?: ClassPerformance[];
  gymPerformances?: GymPerformance[];
  exhibitionClubs?: ExhibitionClub[];
};
const snapshot = performancesSnapshot as unknown as Snapshot;
const formatTime = (date: Date) =>
  new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
const formatDay = (date: Date) =>
  new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).format(date);

const socialAccountName = (href: string) => {
  try {
    const url = new URL(href);
    const segments = url.pathname.split('/').filter(Boolean);
    const account =
      segments.find((segment) => segment.startsWith('@')) ?? segments[0];
    if (account) {
      const decoded = decodeURIComponent(account);
      return decoded.startsWith('@') ? decoded : `@${decoded}`;
    }
    return url.hostname.replace(/^www\./, '');
  } catch {
    return href;
  }
};

const PerformanceDetail = ({
  type,
  id,
}: {
  type: 'class' | 'gym' | 'club';
  id?: string;
}) => {
  const { route } = useLocation();
  const { acceptance } = useLikedPerformances();
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [availabilityError, setAvailabilityError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<RemainingMode>('total');
  const [issuePath, setIssuePath] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const performanceId = Number(id);
  const backToPerformances = () => {
    sessionStorage.setItem(RESTORE_PERFORMANCE_LIST_SCROLL_KEY, 'true');
    route('/performances');
  };
  const item = useMemo(
    () =>
      type === 'class'
        ? snapshot.performances?.find((p) => p.id === performanceId)
        : type === 'gym'
          ? snapshot.gymPerformances?.find((p) => p.id === performanceId)
          : snapshot.exhibitionClubs?.find((p) => p.id === performanceId),
    [type, performanceId],
  );

  useTitle(
    item
      ? type === 'class'
        ? (item as ClassPerformance).title ||
          (item as ClassPerformance).class_name ||
          '公演詳細'
        : (item as GymPerformance | ExhibitionClub).group_name
      : '公演詳細',
  );
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data: { session } }) => {
      const nextMode = getPublicRemainingMode(session?.user.email);
      setMode(nextMode);
      setIssuePath(
        session
          ? nextMode === 'general'
            ? '/students/issue'
            : '/junior/issue'
          : null,
      );
    });
  }, []);
  useEffect(() => {
    let active = true;
    void getPerformanceAvailability()
      .then((result) => {
        if (!active) {
          return;
        }
        if (result.error) {
          setAvailabilityError(true);
        } else {
          setAvailability(result.data as Availability | null);
        }
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setAvailabilityError(true);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (!item) {
    return (
      <>
        <BackButton onClick={backToPerformances} />
        <p>公演が見つかりません。</p>
      </>
    );
  }
  const details =
    type === 'class'
      ? (item as ClassPerformance)
      : type === 'gym'
        ? (item as GymPerformance)
        : (item as ExhibitionClub);
  const classItem = item as ClassPerformance;
  const gymGroupName =
    type === 'gym' ? (item as GymPerformance).group_name : null;
  const records =
    type === 'club'
      ? []
      : type === 'class'
        ? ((availability?.schedules ?? []) as Schedule[]).map((schedule) => {
            const start = schedule.start_at
              ? new Date(schedule.start_at)
              : null;
            const end = start
              ? new Date(
                  start.getTime() +
                    Number(snapshot.showLengthMinutes ?? 0) * 60_000,
                )
              : null;
            const counter = (
              (availability?.class_counters ?? []) as Counter[]
            ).find(
              (c) => c.class_id === performanceId && c.round_id === schedule.id,
            );
            const remaining = getClassRemaining({
              totalCapacity: classItem.total_capacity ?? 0,
              juniorCapacity: classItem.junior_capacity ?? 0,
              issuedGeneral: Number(counter?.issued_general ?? 0),
              issuedJunior: Number(counter?.issued_junior ?? 0),
              issuedOther: Number(counter?.issued_other ?? 0),
              mode,
              isJuniorReleased: Boolean(
                availability?.config?.junior_release_open,
              ),
            });
            return {
              key: schedule.id,
              roundName: schedule.round_name,
              start,
              end,
              remaining,
              capacity: getCapacityForMode(
                classItem.total_capacity ?? 0,
                classItem.junior_capacity ?? 0,
                mode,
              ),
              accepting:
                Boolean(
                  (availability?.class_performances ?? []).find(
                    (p) => p.id === performanceId,
                  )?.is_accepting,
                ) &&
                Boolean(
                  schedule &&
                  (availability?.schedules ?? []).find(
                    (s) => s.id === schedule.id,
                  )?.is_active,
                ),
            };
          })
        : (availability?.gym_performances ?? [])
            .filter((p) => p.group_name === gymGroupName)
            .map((p) => {
              const counter = (
                (availability?.gym_counters ?? []) as Counter[]
              ).find((c) => c.performance_id === p.id);
              const remaining = getGymRemaining({
                totalCapacity: p.capacity,
                juniorCapacity: p.junior_capacity ?? 0,
                issuedGeneral: Number(counter?.issued_general ?? 0),
                issuedJunior: Number(counter?.issued_junior ?? 0),
                issuedOther: Number(counter?.issued_other ?? 0),
                mode,
                isJuniorReleased: Boolean(
                  availability?.config?.junior_release_open,
                ),
              });
              return {
                key: p.id,
                roundName: p.round_name,
                start: new Date(p.start_at),
                end: new Date(p.end_at),
                remaining,
                capacity: getCapacityForMode(
                  p.capacity,
                  p.junior_capacity ?? 0,
                  mode,
                ),
                accepting: p.is_accepting === true,
              };
            });
  const validRecords = records.filter(
    (row) => row.start !== null && row.end !== null,
  ) as Array<
    Omit<(typeof records)[number], 'start' | 'end'> & { start: Date; end: Date }
  >;
  const grouped = validRecords
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .reduce<Map<string, typeof validRecords>>((map, row) => {
      const key = formatDay(row.start);
      map.set(key, [...(map.get(key) ?? []), row]);
      return map;
    }, new Map());
  const handleIssue = (row: (typeof validRecords)[number]) => {
    if (
      !issuePath ||
      now >= row.start ||
      row.remaining <= 0 ||
      !row.accepting
    ) {
      return;
    }
    const params: Record<string, string> =
      type === 'class'
        ? { performanceId: String(performanceId), scheduleId: String(row.key) }
        : { venue: 'gym', performanceId: String(row.key) };
    route(`${issuePath}?${new URLSearchParams(params).toString()}`);
  };

  const classDetails = type === 'class' ? (details as ClassPerformance) : null;
  const gymDetails = type === 'gym' ? (details as GymPerformance) : null;
  const clubDetails = type === 'club' ? (details as ExhibitionClub) : null;
  const isAccepting =
    type === 'class'
      ? acceptance?.get(`class:${performanceId}`)
      : type === 'gym'
        ? (snapshot.gymPerformances ?? []).some(
            (performance) =>
              performance.group_name === gymDetails?.group_name &&
              acceptance?.get(`gym:${performance.id}`) === true,
          )
        : null;
  const galleryPaths = Array.isArray(details.gallery_paths)
    ? details.gallery_paths.filter(
        (path): path is string => typeof path === 'string',
      )
    : [];
  const externalLinks = details.external_links ?? {};
  const socialLinks = [
    { key: 'instagram', label: 'Instagram', icon: <RiInstagramLine /> },
    { key: 'x', label: 'X', icon: <RiTwitterXFill /> },
    { key: 'tiktok', label: 'TikTok', icon: <RiTiktokFill /> },
  ].flatMap(({ key, label, icon }) => {
    const href = externalLinks[key as keyof ExternalLinks];
    return typeof href === 'string' && href
      ? [{ href, label, account: socialAccountName(href), icon }]
      : [];
  });
  const otherLinks = Array.isArray(externalLinks.others)
    ? externalLinks.others.filter(
        (href): href is string => typeof href === 'string',
      )
    : [];
  return (
    <>
      <BackButton onClick={backToPerformances} />
      <h1 className={baseStyles.pageTitle}>
        {classDetails?.title && (
          <p className={baseStyles.pageSubtitle}>{classDetails?.class_name}</p>
        )}
        {classDetails?.title ??
          gymDetails?.group_name ??
          clubDetails?.group_name}{' '}
      </h1>
      <section className={styles.detail}>
        {details.image_path && (
          <img
            className={styles.image}
            src={getPerformanceImageUrl(
              details.image_path,
              snapshot.generatedAt,
            )}
            alt={
              classDetails?.title ||
              gymDetails?.group_name ||
              clubDetails?.group_name ||
              '公演画像'
            }
          />
        )}

        <div className={styles.likeAction}>
          {isAccepting !== null && isAccepting !== undefined && (
            <span
              className={`${listStyles.statusBadge} ${isAccepting ? listStyles.statusAccepting : listStyles.statusClosed}`}
            >
              {isAccepting ? '受付中' : '受付停止中'}
            </span>
          )}
          <LikeButton
            type={type}
            id={performanceId}
            likeCount={details.like ?? 0}
            overlay={false}
          />
        </div>
        <p className={styles.description}>
          {details.description ||
            (type === 'class'
              ? '説明はありません。'
              : '公演説明はありません。')}
        </p>

        {(socialLinks.length > 0 || otherLinks.length > 0) && (
          <>
            <h2 className={baseStyles.linedH2}>外部リンク</h2>
            <nav className={styles.externalLinks} aria-label='外部リンク'>
              {socialLinks.map(({ href, label, account, icon }) => (
                <a
                  key={href}
                  href={href}
                  target='_blank'
                  rel='noreferrer'
                  aria-label={label}
                >
                  {icon}
                  <span>{account}</span>
                </a>
              ))}
              {otherLinks.map((href, index) => (
                <a
                  key={href}
                  href={href}
                  target='_blank'
                  rel='noreferrer'
                  aria-label={`その他のリンク ${index + 1}`}
                >
                  <IoMdLink />
                  <span>{href}</span>
                </a>
              ))}
            </nav>
          </>
        )}
        {galleryPaths.length > 0 && (
          <>
            <h2 className={baseStyles.linedH2}>ギャラリー</h2>
            <div className={styles.gallery} aria-label='ギャラリー'>
              {galleryPaths.map((path, index) => (
                <img
                  key={path}
                  src={getPerformanceImageUrl(path, snapshot.generatedAt)}
                  alt={`${classDetails?.title || gymDetails?.group_name || clubDetails?.group_name || '公演'}のギャラリー画像 ${index + 1}`}
                  loading='lazy'
                />
              ))}
            </div>
          </>
        )}
      </section>
      {clubDetails ? (
        <section className={styles.detail}>
          <h2 class={baseStyles.linedH2}>場所</h2>
          <p>{clubDetails.location || '場所情報はありません。'}</p>
          <a href='/map' className={styles.mapLink}>
            校内マップを見る
          </a>
        </section>
      ) : (
        <section className={styles.timetable}>
          <h2 class={baseStyles.linedH2}>公演時間・空席状況</h2>
          {loading ? (
            <LoadingSpinner />
          ) : availabilityError ? (
            <p>空席状況を取得できませんでした。</p>
          ) : grouped.size === 0 ? (
            <p>表示できる公演データがありません。</p>
          ) : (
            [...grouped].map(([day, rows]) => (
              <div key={day}>
                <h3>{day}</h3>
                {rows.map((row) => {
                  const ended = now >= row.end;
                  const playing = !ended && now >= row.start;
                  const status = getAvailabilityStatus(
                    row.remaining,
                    row.capacity,
                  );
                  const canIssue = Boolean(
                    issuePath &&
                    !ended &&
                    !playing &&
                    row.remaining > 0 &&
                    row.accepting,
                  );
                  return (
                    <button
                      key={row.key}
                      type='button'
                      className={`${styles.row} ${canIssue ? styles.clickable : ''}`}
                      disabled={!canIssue}
                      onClick={() => handleIssue(row)}
                    >
                      <span className={styles.scheduleTime}>
                        <span>{row.roundName}</span>
                        <span className={styles.timeRange}>
                          {formatTime(row.start)} ─ {formatTime(row.end)}
                        </span>
                      </span>
                      {ended || playing ? (
                        <span className={styles.inactive}>
                          - {ended ? '終了' : '上演中'}
                        </span>
                      ) : (
                        <span
                          className={`${styles[status]} ${styles.remaining}`}
                        >
                          {status === 'circle' ? (
                            <RiCircleLine />
                          ) : status === 'triangle' ? (
                            <RiTriangleLine />
                          ) : (
                            <RiCloseLargeLine />
                          )}{' '}
                          {status === 'cross'
                            ? '満席'
                            : `残り${row.remaining}席`}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </section>
      )}
    </>
  );
};
export default PerformanceDetail;
