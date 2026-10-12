import { BrowserRouter, MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toasts } from './components/ui';
import { StaffLayout } from './layouts/StaffLayout';
import { useSimulation } from './lib/demo/simulate';
import { homeFor, useUser } from './lib/session';
import { SignIn } from './pages/SignIn';
import { Overview } from './pages/staff/Overview';
import { Roster } from './pages/staff/Roster';
import { Rounds } from './pages/staff/Rounds';
import { Live } from './pages/staff/Live';
import { Grading } from './pages/staff/Grading';
import { Results } from './pages/staff/Results';
import { Certificates } from './pages/staff/Certificates';
import { Email } from './pages/staff/Email';
import { Settings } from './pages/staff/Settings';
import { StudentHome } from './pages/student/StudentHome';
import { TestPortal } from './pages/student/TestPortal';
import { CoachHome } from './pages/coach/CoachHome';
import { WaiverPage } from './pages/WaiverPage';
import { BoardPage } from './pages/BoardPage';

const Router = __DEMO_BUILD__ ? MemoryRouter : BrowserRouter;

function Home() {
  return <Navigate to={homeFor(useUser())} replace />;
}

export function App() {
  useSimulation();
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/board" element={<BoardPage />} />
        <Route path="/waiver/:competitorId" element={<WaiverPage />} />
        <Route path="/staff" element={<StaffLayout />}>
          <Route index element={<Overview />} />
          <Route path="roster" element={<Roster />} />
          <Route path="rounds" element={<Rounds />} />
          <Route path="live" element={<Live />} />
          <Route path="grading" element={<Grading />} />
          <Route path="results" element={<Results />} />
          <Route path="certificates" element={<Certificates />} />
          <Route path="email" element={<Email />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="/coach" element={<CoachHome />} />
        <Route path="/me" element={<StudentHome />} />
        <Route path="/me/test/:roundId" element={<TestPortal />} />
        <Route path="*" element={<Home />} />
      </Routes>
      <Toasts />
    </Router>
  );
}
