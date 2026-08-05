import {
  ErrorBoundary,
  LocationProvider,
  Route,
  Router,
  useLocation,
} from 'preact-iso';

import { ScrollToTop } from './utils/ScrollToTop';
import { useEffect, useState } from 'preact/hooks';
import {
  FAQ,
  Junior,
  JuniorAccounts,
  preload,
  ScanHistory,
  TimeTable,
  Map,
  Pamphlet,
  Info,
  Settings,
  Status,
  TicketManagement,
  AdminTicketIssue,
  StudentAccounts,
  SecretBase,
  OrganizationAdmin,
  OrganizationAccounts,
  PerformancesManagement,
} from './routes';
import LineCallback from './features/auth/Line';
import NotFound from './shared/NotFound';

// route components; Ticket and TicketHistory are still eager
import {
  MainLayout,
  AdminLayout,
  ScanLayout,
  Home,
  Performances,
  DayTicketIssue,
  DayTicketIssueResult,
  Students,
  AdminHome,
  Scan,
  Register,
  Ticket,
  TicketHistory,
} from './routes';

import './styles/color-settings.css';
import './styles/index.css';
import subPageStyles from './styles/sub-pages.module.css';
import browserModalStyles from './styles/browser-modal.module.css';
import { useTicketCleanup } from './features/tickets/useTicketCleanup';
import { PWAUpdateToast } from './components/PWAUpdateToast';
import openInBrowserHint from './assets/open-in-browser-hint.webp';

function getInAppBrowserType(): 'line' | 'other' | null {
  const ua = navigator.userAgent.toLowerCase();

  if (ua.includes('line')) {
    return 'line';
  }

  if (
    ua.includes('instagram') ||
    ua.includes('fban') ||
    ua.includes('fbav') ||
    ua.includes('twitter') ||
    ua.includes('micromessenger') ||
    ua.includes('tiktok')
  ) {
    return 'other';
  }

  return null;
}

function openExternalBrowser() {
  const type = getInAppBrowserType();

  if (type === 'line') {
    const url = new URL(window.location.href);
    url.searchParams.set('openExternalBrowser', '1');

    window.location.href = url.toString();
    return;
  }

  alert(
    '画面右上のメニューから\n「Safariで開く」または「Chromeで開く」、「デフォルトのブラウザで開く」などを選択してください。',
  );
}

const userPageLayout = () => (
  <MainLayout>
    <div className={subPageStyles.subPageShell}>
      <Router>
        <Route path='/' component={HomePageLayout} />
        <Route path='/t' component={TicketHistory} />
        <Route path='/t/:id' component={Ticket} />
        <Route path='/day-tickets/result' component={DayTicketIssueResult} />
        <Route path='/day-tickets' component={DayTicketIssue} />
        <Route path='/performances' component={Performances} />
        <Route path='/faq' component={FAQ} />
        <Route path='/timetable' component={TimeTable} />
        <Route path='/map' component={Map} />
        <Route path='/pamphlet' component={Pamphlet} />
        <Route path='/info' component={Info} />
        <Route path='/organization-admin' component={OrganizationAdmin} />
        <Route path='/gunawan' component={SecretBase} />
        <Route path='/gunawanrio' component={SecretBase} />
        <Route path='/rio' component={SecretBase} />
        <Route path='/riogunawan' component={SecretBase} />
        <Route path='/auth/line/callback' component={LineCallback} />
        <Route default component={NotFound} />
      </Router>
    </div>
  </MainLayout>
);

const AdminPageLayout = () => (
  <AdminLayout>
    <div className={subPageStyles.subPageShell}>
      <Router>
        <Route path='/' component={AdminHome} />
        <Route path='/register' component={Register} />
        <Route path='/history' component={ScanHistory} />
        <Route path='settings' component={Settings} />
        <Route path='/status' component={Status} />
        <Route path='/tickets' component={TicketManagement} />
        <Route path='/tickets/issue' component={AdminTicketIssue} />
        <Route path='/student-accounts' component={StudentAccounts} />
        <Route path='/junior-accounts' component={JuniorAccounts} />
        <Route path='/organization-accounts' component={OrganizationAccounts} />
        <Route path='/performances-management' component={PerformancesManagement} />
        <Route default component={NotFound} />
      </Router>
    </div>
  </AdminLayout>
);

const AdminScanLayout = () => (
  <ScanLayout>
    <Scan />
  </ScanLayout>
);

const HomePageLayout = () => (
  <MainLayout>
    <Home />
  </MainLayout>
);

const InnerApp = () => {
  const { path } = useLocation();

  // when the app first mounts (or path changes) prefetch the chunk for the current route
  useEffect(() => {
    if (path === '/' || path === '') {
      preload(Home);
    } else if (path.startsWith('/students')) {
      preload(Students);
    } else if (path.startsWith('/junior')) {
      preload(Junior);
    } else if (path.startsWith('/day-tickets')) {
      preload(DayTicketIssue, DayTicketIssueResult);
    } else if (path.startsWith('/performances')) {
      preload(Performances);
    } else if (path.startsWith('/faq')) {
      preload(FAQ);
    } else if (path.startsWith('/timetable')) {
      preload(TimeTable);
    } else if (path.startsWith('/map')) {
      preload(Map);
    } else if (path.startsWith('pamphlet')) {
      preload(Pamphlet);
    } else if (path.startsWith('/info')) {
      preload(Info);
    } else if (path.startsWith('/admin/scan')) {
      preload(AdminLayout, ScanLayout, Scan, AdminHome);
    } else if (path.startsWith('/admin')) {
      preload(AdminLayout, AdminHome);
    }
  }, [path]);

  return (
    <Router>
      <Route path='/' component={HomePageLayout} />
      <Route path='/students' component={Students} />
      <Route path='/students/*' component={Students} />
      <Route path='/admin/scan' component={AdminScanLayout} />
      <Route path='/admin/*' component={AdminPageLayout} />
      <Route path='/admin' component={AdminPageLayout} />
      <Route path='/junior/*' component={Junior} />
      <Route path='/junior' component={Junior} />
      <Route path='/*' component={userPageLayout} />
      <Route default component={NotFound} />
    </Router>
  );
};

const App = () => {
  const [showBrowserModal, setShowBrowserModal] = useState(false);
  const [browserType, setBrowserType] = useState<'line' | 'other' | null>(null);

  useEffect(() => {
    const type = getInAppBrowserType();

    if (type) {
      setBrowserType(type);
      setShowBrowserModal(true);
    }
  }, []);

  useTicketCleanup();
  return (
    <LocationProvider>
      <ScrollToTop />
      <ErrorBoundary>
        {showBrowserModal && (
          <div className={browserModalStyles.modalOverlay}>
            <div className={browserModalStyles.modalContainer}>
              <h2 className={browserModalStyles.modalHeading}>
                デフォルトのブラウザで開くことをおすすめします
              </h2>

              <p>
                現在アプリ内ブラウザで開いています。
                <br />
                デフォルトのブラウザをご使用いただくと、チケット表示履歴やオフライン対応等、より便利にご利用いただけます。
              </p>

              {browserType === 'line' ? (
                <>
                  <button
                    onClick={openExternalBrowser}
                    className={browserModalStyles.primaryButton}
                  >
                    Safari / Chromeで開く
                  </button>
                </>
              ) : (
                <>
                  <h2>ブラウザでの開き方</h2>
                  <ol>
                    <li>右上または右下の「…」または共有アイコンをタップ</li>
                    <li>
                      「Safariで開く」または「Chromeで開く」、「デフォルトのブラウザで開く」などを選択
                    </li>
                  </ol>
                  <p>画像はAndroid版Instagramでの例</p>
                  <img
                    src={openInBrowserHint}
                    alt='ブラウザで開く方法'
                    width={300}
                    className={browserModalStyles.hintImage}
                  />
                </>
              )}

              <button
                onClick={() => setShowBrowserModal(false)}
                className={browserModalStyles.secondaryButton}
              >
                このまま利用する
              </button>
            </div>
          </div>
        )}
        <InnerApp />
      </ErrorBoundary>
      <PWAUpdateToast />
    </LocationProvider>
  );
};

export default App;
