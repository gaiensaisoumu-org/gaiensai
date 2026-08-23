import { useRef, useState } from 'preact/hooks';
import { useTitle } from '../../hooks/useTitle';
import styles from '../../styles/sub-pages.module.css';
import Modal2 from '../../components/ui/Modal2';
import pamphletStyles from './Pamphlet.module.css';
import Alert from '../../components/ui/Alert';

const pamphletPages = Object.entries(
  import.meta.glob('../../assets/pamphlet/*.webp', {
    eager: true,
    import: 'default',
    query: '?url',
  }),
)
  .map(([path, src]) => ({
    page: Number(path.match(/\/(\d+)\.webp$/)?.[1]),
    src: src as string,
  }))
  .sort((a, b) => a.page - b.page);

const Pamphlet = () => {
  const [viewMode, setViewMode] = useState<'vertical' | 'horizontal'>(
    'horizontal',
  );
  const [currentPage, setCurrentPage] = useState(0);
  const readerRef = useRef<HTMLDivElement>(null);

  useTitle('パンフレット');

  const selectPage = (index: number) => {
    const reader = readerRef.current;
    const targetPage = reader?.children[index] as HTMLElement | undefined;
    reader?.scrollTo({ left: targetPage?.offsetLeft, behavior: 'smooth' });
    setCurrentPage(index);
  };

  return (
    <>
      <Modal2 />
      <h1 className={styles.pageTitle}>パンフレット</h1>
      <Alert type='info'>
        <h3>クイズ研究部の方へ</h3>
        <p>
          校内マップの表示が「クイズ研究会」になっていることの修正依頼は、すでに8/3には総務に伝達しましたが、
          依然訂正版が届かず、こちらのパンフレットも誤った表記のままであるという状況です。
          ご迷惑をおかけしていますこと、お詫び申し上げます。
        </p>
      </Alert>
      <section
        className={
          viewMode === 'horizontal'
            ? pamphletStyles.pamphletHorizontal
            : pamphletStyles.pamphletVertical
        }
        aria-label='外苑祭2026 パンフレット'
      >
        <div className={pamphletStyles.viewControls} aria-label='表示方法'>
          <button
            type='button'
            className={
              viewMode === 'horizontal' ? pamphletStyles.activeMode : undefined
            }
            aria-pressed={viewMode === 'horizontal'}
            onClick={() => setViewMode('horizontal')}
          >
            横スワイプ
          </button>
          <button
            type='button'
            className={
              viewMode === 'vertical' ? pamphletStyles.activeMode : undefined
            }
            aria-pressed={viewMode === 'vertical'}
            onClick={() => setViewMode('vertical')}
          >
            縦スクロール
          </button>
        </div>

        {viewMode === 'vertical' ? (
          <div className={pamphletStyles.verticalReader}>
            {pamphletPages.map(({ page, src }) => (
              <img
                key={page}
                src={src}
                alt={`パンフレット ${page + 1}ページ`}
                loading='lazy'
              />
            ))}
          </div>
        ) : (
          <>
            <div
              ref={readerRef}
              className={pamphletStyles.horizontalReader}
              aria-label='横スワイプでパンフレットを読む'
              onScroll={(event) => {
                const reader = event.currentTarget;
                const pageWidth = (
                  reader.firstElementChild as HTMLElement | null
                )?.offsetWidth;
                if (pageWidth) {
                  setCurrentPage(Math.round(reader.scrollLeft / pageWidth));
                }
              }}
            >
              {pamphletPages.map(({ page, src }, index) => (
                <div
                  id={`pamphlet-page-${index}`}
                  className={pamphletStyles.horizontalPage}
                  key={page}
                >
                  <img src={src} alt={`パンフレット ${page + 1}ページ`} />
                </div>
              ))}
            </div>
            <div
              className={pamphletStyles.pageMoveControls}
              aria-label='ページ移動'
            >
              <button
                type='button'
                className={pamphletStyles.pageMoveButton}
                aria-label='前のページへ'
                disabled={currentPage === 0}
                onClick={() => selectPage(currentPage - 1)}
              >
                ‹
              </button>
              <button
                type='button'
                className={pamphletStyles.pageMoveButton}
                aria-label='次のページへ'
                disabled={currentPage === pamphletPages.length - 1}
                onClick={() => selectPage(currentPage + 1)}
              >
                ›
              </button>
            </div>
            <nav
              className={pamphletStyles.pageList}
              aria-label='パンフレットのページ一覧'
            >
              {pamphletPages.map(({ page, src }, index) => (
                <button
                  type='button'
                  className={
                    currentPage === index
                      ? pamphletStyles.currentPage
                      : undefined
                  }
                  aria-current={currentPage === index ? 'page' : undefined}
                  aria-label={`${page + 1}ページを表示`}
                  onClick={() => selectPage(index)}
                  key={page}
                >
                  <img src={src} alt='' />
                  <span>{page + 1}</span>
                </button>
              ))}
            </nav>
          </>
        )}
      </section>
    </>
  );
};

export default Pamphlet;
