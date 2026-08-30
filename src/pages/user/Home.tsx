import Alert from '../../components/ui/Alert';
import Gallery from '../../components/ui/Gallery';
import NormalSection from '../../components/ui/NormalSection';

import sharedStyles from '../../styles/shared.module.css';
import styles from './Home.module.css';

import dotConstellation from '../../assets/decor/dot-constellation.svg';
import hexGrid from '../../assets/decor/hex-grid.svg';
import triangleMix from '../../assets/decor/triangle-mix.svg';
import zigzagBand from '../../assets/decor/zigzag-band.svg';
import gaiensai_about from '../../assets/gaiensai_about.webp';
import capsuleFlow from '../../assets/hero/capsule-flow.svg';
import diamondStack from '../../assets/hero/diamond-stack.svg';
import meshWave from '../../assets/hero/mesh-wave.svg';
import ringOrbit from '../../assets/hero/ring-orbit.svg';
import sparkBurst from '../../assets/hero/spark-burst.svg';
import inner2 from '../../assets/inner/inner2.webp';
import inner3 from '../../assets/inner/inner3.webp';
import inner4 from '../../assets/inner/inner4.webp';
import inner5 from '../../assets/inner/inner5.webp';
import outer1 from '../../assets/outer/outer1.webp';
import outer2 from '../../assets/outer/outer2.webp';
import outer3 from '../../assets/outer/outer3.webp';
import outer4 from '../../assets/outer/outer4.webp';
import outer5 from '../../assets/outer/outer5.webp';
import poster from '../../assets/poster.webp';
import prepare1 from '../../assets/prepare/prepare1.webp';
import prepare2 from '../../assets/prepare/prepare2.webp';
import prepare3 from '../../assets/prepare/prepare3.webp';
import prepare4 from '../../assets/prepare/prepare4.webp';
import prepare5 from '../../assets/prepare/prepare5.webp';
import sign1 from '../../assets/sign/sign1.webp';
import sign2 from '../../assets/sign/sign2.webp';
import sign3 from '../../assets/sign/sign3.webp';
import sign4 from '../../assets/sign/sign4.webp';
import sign5 from '../../assets/sign/sign5.webp';

import { useEffect, useMemo, useState } from 'preact/hooks';
import type { GalleryImage } from '../../types/types';
import { useEventConfig } from '../../hooks/useEventConfig';

import { BiSolidFoodMenu } from 'react-icons/bi';
import { FaQuestionCircle } from 'react-icons/fa';
import { FaMapLocationDot } from 'react-icons/fa6';
import { GrSchedulePlay } from 'react-icons/gr';
import { IoIosWarning, IoMdTrain } from 'react-icons/io';
import { PiMicrophoneStageFill } from 'react-icons/pi';

// preload helper for code‑split routes
import { preload, Students, Performances } from '../../routes';
import { useTitle } from '../../hooks/useTitle';
import Modal2 from '../../components/ui/Modal2';

const prepareGallery: GalleryImage[] = [
  { src: prepare1, alt: '舞台準備の様子1', width: 300 },
  { src: prepare2, alt: '舞台準備の様子2', width: 300 },
  { src: prepare3, alt: '舞台準備の様子3', width: 300 },
  { src: prepare4, alt: '舞台準備の様子4', width: 300 },
  { src: prepare5, alt: '舞台準備の様子5', width: 300 },
];

const signGallery: GalleryImage[] = [
  { src: sign1, alt: '立て看板のディテール1', width: 300 },
  { src: sign2, alt: '立て看板のディテール2', width: 300 },
  { src: sign3, alt: '立て看板のディテール3', width: 300 },
  { src: sign4, alt: '立て看板のディテール4', width: 300 },
  { src: sign5, alt: '立て看板のディテール5', width: 300 },
];

const outerGallery: GalleryImage[] = [
  { src: outer1, alt: '外装パネル1', width: 300 },
  { src: outer2, alt: '外装パネル2', width: 300 },
  { src: outer3, alt: '外装パネル3', width: 300 },
  { src: outer4, alt: '外装パネル4', width: 300 },
  { src: outer5, alt: '外装パネル5', width: 300 },
];

const innerGallery: GalleryImage[] = [
  { src: inner2, alt: '内装ディテール1', width: 300 },
  { src: inner3, alt: '内装ディテール2', width: 300 },
  { src: inner4, alt: '内装ディテール3', width: 300 },
  { src: inner5, alt: '内装ディテール4', width: 300 },
];

const Home = () => {
  useTitle('');
  const { config } = useEventConfig();

  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY);
    };

    // スクロールイベントを登録
    window.addEventListener('scroll', handleScroll, { passive: true });

    // クリーンアップ関数（コンポーネントの破棄時にイベントを解除）
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const formattedDateText = useMemo(() => {
    if (config.date.length === 0) {
      return '';
    }

    const toParts = (dateText: string) => {
      const [year, month, day] = dateText
        .split('-')
        .map((value) => Number(value));
      return { year, month, day };
    };

    const first = toParts(config.date[0]);
    const last = toParts(config.date[config.date.length - 1]);

    if (first.year === last.year && first.month === last.month) {
      return `${first.year}/${first.month}/${first.day}~${last.day}`;
    }

    return `${first.year}/${first.month}/${first.day}~${last.year}/${last.month}/${last.day}`;
  }, [config.date]);

  const totalClassCount = config.grade_number * config.class_number;

  useEffect(() => {
    const sections = document.querySelectorAll<HTMLElement>(
      '[data-scroll-section]',
    );
    if (sections.length === 0) {
      return;
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      sections.forEach((section) => section.classList.add(styles.isVisible));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }
          entry.target.classList.add(styles.isVisible);
          observer.unobserve(entry.target);
        });
      },
      {
        threshold: 0.24,
        rootMargin: '0px 0px -8% 0px',
      },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {scrollY > 0 && <Modal2 />}
      <section className={styles.firstView}>
        <img src={poster} alt='外苑祭ポスター' fetchPriority='high' />
        <div className={styles.firstViewContent}>
          <div className={styles.heroShapes} aria-hidden='true'>
            <img
              src={meshWave}
              alt=''
              className={`${styles.heroShape} ${styles.meshWave}`}
            />
            <img
              src={ringOrbit}
              alt=''
              className={`${styles.heroShape} ${styles.ringOrbit}`}
            />
            <img
              src={capsuleFlow}
              alt=''
              className={`${styles.heroShape} ${styles.capsuleFlow}`}
            />
            <img
              src={diamondStack}
              alt=''
              className={`${styles.heroShape} ${styles.diamondStack}`}
            />
            <img
              src={sparkBurst}
              alt=''
              className={`${styles.heroShape} ${styles.sparkBurst}`}
            />
          </div>
          <div className={styles.firstViewText}>
            <h1 className={styles.firstViewH1}>
              {config.name} {config.year}
            </h1>
            <p className={styles.firstViewCatchCopy}>{config.catchCopy}</p>
            <div className={styles.firstViewDetail}>
              <p className={styles.firstViewDate}>{formattedDateText}</p>
              <p className={styles.firstViewPlace}>{config.school}</p>
            </div>
          </div>
        </div>
        <div className={styles.scroll}>
          <span>Scroll</span>
        </div>
      </section>

      <Alert type='info'>
        今年の外苑祭は無事終了いたしました。ご来場いただいた6130人の皆様、ありがとうございました。
      </Alert>

      <Alert
        className={styles.scrollSection}
        type='warning'
        data-scroll-section=''
      >
        <p>
          外苑祭は
          <strong>
            青高生からの招待券をお持ちの方、および事前申込をした中学生のみ
          </strong>
          ご来場いただけます。一般の方のご入場はお断りいたします。
        </p>
      </Alert>
      <NormalSection className={styles.scrollSection} data-scroll-section=''>
        <h2>ご来場の皆様へ</h2>
        <p>
          体育館公演をご覧になる方は、<strong>上履き</strong>をご持参ください。
          クラス公演・展示部活のみをご覧になる方は上履きは不要です。
        </p>
        <h3>外苑祭2日目のご来場について</h3>
        <p>
          外苑祭2日目は、2日目の公演のチケットを持っていなくても、1日目のチケットがあれば入場可能です。
          その際、機能も入場したことを係員にお伝えください。また、入場に使用するチケットは使用済みでも未使用でも大丈夫です。
        </p>
      </NormalSection>
      <NormalSection className={styles.scrollSection} data-scroll-section=''>
        <h2>生徒用ページ</h2>
        <p>
          青高生の皆さんは、
          <a href='/students/login' onMouseEnter={() => preload(Students)}>
            こちら
          </a>
          からダッシュボードにアクセスしてください。
        </p>
      </NormalSection>
      <NormalSection className={styles.scrollSection} data-scroll-section=''>
        <h2>中学生用ページ</h2>
        <p>
          すでに当選メールから登録をした方は、
          <a href='/junior/login' onMouseEnter={() => preload(Students)}>
            こちら
          </a>
          からログインが可能です。
        </p>
      </NormalSection>
      <NormalSection className={styles.scrollSection} data-scroll-section=''>
        <h2>公演空き状況</h2>
        <p>
          公演の空き状況は
          <a href='/availability' onMouseEnter={() => preload(Students)}>
            こちら
          </a>
          からご確認ください。また、各学年フロアのオープンスペースにモニターでも掲示しております。
        </p>
      </NormalSection>
      <NormalSection className={styles.scrollSection} data-scroll-section=''>
        <h2>チケット</h2>
        <p>
          招待券は、お使いのデバイスで表示したことのあるもののみ表示できます。まだ閲覧していない場合は、招待URLよりアクセスしてください。
        </p>
        <a href='/t'>チケットを表示する</a>
      </NormalSection>
      <NormalSection className={styles.scrollSection} data-scroll-section=''>
        <h2>お問い合わせについて</h2>
        <p>
          外苑祭当日にいただいたお問い合わせは、当日中の返信はできません。お急ぎの方は、3階総務室へお越しください。
        </p>
      </NormalSection>
      <section
        className={`${styles.buttonLinkWrap} ${styles.scrollSection}`}
        data-scroll-section=''
      >
        <h2 className={sharedStyles.normalH2}>ご案内</h2>
        <div className={styles.sectionDecor} aria-hidden='true'>
          <img
            src={hexGrid}
            alt=''
            className={`${styles.decorItem} ${styles.decorHex}`}
          />
          <img
            src={dotConstellation}
            alt=''
            className={`${styles.decorItem} ${styles.decorDots}`}
          />
          <img
            src={zigzagBand}
            alt=''
            className={`${styles.decorItem} ${styles.decorZigzag}`}
          />
          <img
            src={triangleMix}
            alt=''
            className={`${styles.decorItem} ${styles.decorTriangle}`}
          />
        </div>
        <div className={styles.buttonLinkSection}>
          <a
            href='/performances'
            className={styles.buttonLink}
            onMouseEnter={() => preload(Performances)}
          >
            <PiMicrophoneStageFill />
            演目一覧
          </a>
          <a href='/timetable' className={styles.buttonLink}>
            <GrSchedulePlay />
            タイムテーブル
          </a>
          <a href='/pamphlet' className={styles.buttonLink}>
            <BiSolidFoodMenu />
            デジタルパンフレット
          </a>
        </div>
      </section>
      <NormalSection className={styles.scrollSection} data-scroll-section=''>
        <h2>外苑祭とは</h2>
        <div className={sharedStyles.imgBox}>
          <img src={gaiensai_about} width={800} alt='外苑祭の表彰式の風景' />
          <div>
            <h3 className={styles.catchCopy}>
              <span>全クラスが演劇</span>を上演する、 ちょっと変わった文化祭。
            </h3>
            <p>
              外苑祭とは、青山高校の生徒が主体となって企画・運営する文化祭です。毎年8月下旬に開催され、5000人以上が来場する伝統行事です。
              全{totalClassCount}
              クラス全てが演劇またはミュージカルを披露し、体育館では部活のパフォーマンスが行われます。
            </p>
          </div>
        </div>
      </NormalSection>
      <NormalSection className={styles.scrollSection} data-scroll-section=''>
        <h2>見どころ</h2>
        <Gallery images={prepareGallery} />
        <p>
          脚本、演出、外装、内装、照明、音響まで、すべてを生徒たち自身が工夫を凝らし、つくり上げます。この圧巻のクオリティをお楽しみください。
        </p>
        <h3>立て看板</h3>
        <Gallery images={signGallery} />
        <p>
          校門を抜けて、受付までの道中で、各クラスが作った立て看板がお迎えします。クラスによっては立体的に作られているなどの工夫があります。
        </p>
        <h3>外装</h3>
        <Gallery images={outerGallery} />
        <p>
          各クラスの前には華やかな外装が施されています。クラスによっては、ライトで装飾したり、モーターで回す仕掛けがついてるところもあります。
        </p>
        <h3>内装</h3>
        <Gallery images={innerGallery} />
        <p>
          劇に直結する内装です。どのように台本の雰囲気を出すか、それぞれが考えて装飾がなされています。演技だけでなく、内装の違いにも個性が現れています。
        </p>
      </NormalSection>
      <section
        className={`${styles.scrollSection} ${styles.visitorSection}`}
        data-scroll-section=''
      >
        <div className={styles.sectionDecor} aria-hidden='true'>
          <img
            src={hexGrid}
            alt=''
            className={`${styles.decorItem} ${styles.decorHexBottom}`}
          />
          <img
            src={dotConstellation}
            alt=''
            className={`${styles.decorItem} ${styles.decorDotsBottom}`}
          />
          <img
            src={triangleMix}
            alt=''
            className={`${styles.decorItem} ${styles.decorTriangleBottom}`}
          />
        </div>
        <h2 className={sharedStyles.normalH2}>ご来場の皆様へ</h2>
        <div className={styles.buttonLinkSection}>
          <a href='/info' className={styles.buttonLink}>
            <IoIosWarning />
            ご来場の注意
          </a>
          <a href='/map' className={styles.buttonLink}>
            <FaMapLocationDot />
            校内マップ
          </a>
          <a
            href='https://www.metro.ed.jp/aoyama-h/access/access.html'
            className={styles.buttonLink}
          >
            <IoMdTrain />
            アクセス
          </a>
          <a href='/faq' className={styles.buttonLink}>
            <FaQuestionCircle />
            FAQ
          </a>
        </div>
      </section>
    </>
  );
};

export default Home;
