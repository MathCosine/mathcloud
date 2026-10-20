import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { BrowserRouter, MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { REMOTE, useReady } from './lib/store';
import { boot, onRemoteError } from './lib/remote/live';
import { toast, Toasts } from './components/ui';
import { StaffLayout } from './layouts/StaffLayout';
import { useSimulation } from './lib/demo/simulate';
import { homeFor, useUser } from './lib/session';
import { SignIn } from './pages/SignIn';
import { Landing } from './pages/Landing';

/** Each screen is its own download, fetched the first time it is opened. */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}

const SignUp = page(() => import('./pages/SignUp'), 'SignUp');
const Welcome = page(() => import('./pages/Welcome'), 'Welcome');
const Account = page(() => import('./pages/Account'), 'Account');
const ContestPage = page(() => import('./pages/ContestPage'), 'ContestPage');
const Register = page(() => import('./pages/Register'), 'Register');
const WaiverPage = page(() => import('./pages/WaiverPage'), 'WaiverPage');
const BoardPage = page(() => import('./pages/BoardPage'), 'BoardPage');
const Overview = page(() => import('./pages/staff/Overview'), 'Overview');
const NewContest = page(() => import('./pages/staff/NewContest'), 'NewContest');
const Teams = page(() => import('./pages/staff/Teams'), 'Teams');
const People = page(() => import('./pages/staff/People'), 'People');
const Waivers = page(() => import('./pages/staff/Waivers'), 'Waivers');
const Import = page(() => import('./pages/staff/Import'), 'Import');
const Rounds = page(() => import('./pages/staff/Rounds'), 'Rounds');
const Problems = page(() => import('./pages/staff/Problems'), 'Problems');
const RoundPreview = page(() => import('./pages/staff/RoundPreview'), 'RoundPreview');
const Practice = page(() => import('./pages/student/Practice'), 'Practice');
const PublicBoard = page(() => import('./pages/PublicBoard'), 'PublicBoard');
const Live = page(() => import('./pages/staff/Live'), 'Live');
const Grading = page(() => import('./pages/staff/Grading'), 'Grading');
const Results = page(() => import('./pages/staff/Results'), 'Results');
const Reports = page(() => import('./pages/staff/Reports'), 'Reports');
const Email = page(() => import('./pages/staff/Email'), 'Email');
const Settings = page(() => import('./pages/staff/Settings'), 'Settings');
const CoachHome = page(() => import('./pages/coach/CoachHome'), 'CoachHome');
const StudentHome = page(() => import('./pages/student/StudentHome'), 'StudentHome');
const TestPortal = page(() => import('./pages/student/TestPortal'), 'TestPortal');

const Router = __DEMO_BUILD__ ? MemoryRouter : BrowserRouter;

/** Signed out: the front page. Signed in: straight to your own place. */
function Home() {
  const user = useUser();
  return user ? <Navigate to={homeFor(user)} replace /> : <Landing />;
}

function Loading() {
  return <div className="booting" role="status"><span className="spinner" />Loading</div>;
}

export function App() {
  useSimulation();
  const ready = useReady();
  useEffect(() => {
    if (!REMOTE) return;
    const off = onRemoteError((title, detail) => toast(title, detail, 'r'));
    void boot();
    return () => void off();
  }, []);
  if (!ready) return <Loading />;
  return (
    <Router basename={__DEMO_BUILD__ ? undefined : import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/sign-up" element={<SignUp />} />
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/account" element={<Account />} />
          <Route path="/c/:slug" element={<ContestPage />} />
          <Route path="/c/:slug/board" element={<PublicBoard />} />
          <Route path="/practice" element={<Practice />} />
          <Route path="/board" element={<BoardPage />} />
          <Route path="/waiver/:token" element={<WaiverPage />} />
          <Route path="/register" element={<Register />} />
          <Route path="/register/:slug" element={<Register />} />
          <Route path="/staff" element={<StaffLayout />}>
            <Route index element={<Overview />} />
            <Route path="new" element={<NewContest />} />
            <Route path="teams" element={<Teams />} />
            <Route path="people" element={<People />} />
            <Route path="waivers" element={<Waivers />} />
            <Route path="import" element={<Import />} />
            <Route path="problems" element={<Problems />} />
            <Route path="rounds" element={<Rounds />} />
            <Route path="preview/:roundId" element={<RoundPreview />} />
            <Route path="live" element={<Live />} />
            <Route path="grading" element={<Grading />} />
            <Route path="results" element={<Results />} />
            <Route path="reports" element={<Reports />} />
            <Route path="email" element={<Email />} />
            <Route path="settings" element={<Settings />} />
            {/* Older addresses, so bookmarks keep working. */}
            <Route path="roster" element={<Navigate to="/staff/teams" replace />} />
            <Route path="roster/import" element={<Navigate to="/staff/import" replace />} />
            <Route path="setup" element={<Navigate to="/staff/settings" replace />} />
            <Route path="certificates" element={<Navigate to="/staff/reports" replace />} />
          </Route>
          <Route path="/coach" element={<CoachHome />} />
          <Route path="/me" element={<StudentHome />} />
          <Route path="/me/test/:roundId" element={<TestPortal />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <Toasts />
    </Router>
  );
}
