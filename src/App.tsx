import { BrowserRouter, MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toasts } from './components/ui';
import { DemoPill } from './components/DemoPill';
import { StaffLayout } from './layouts/StaffLayout';
import { homeFor, useUser } from './lib/session';
import { SignIn } from './pages/SignIn';
import { Overview } from './pages/staff/Overview';
import { Roster } from './pages/staff/Roster';
import { CheckIn } from './pages/staff/CheckIn';
import { People } from './pages/staff/People';
import { Rounds } from './pages/staff/Rounds';
import { Proctoring } from './pages/staff/Proctoring';
import { Grading } from './pages/staff/Grading';
import { Results } from './pages/staff/Results';
import { Certificates } from './pages/staff/Certificates';
import { Emails } from './pages/staff/Emails';
import { StudentHome } from './pages/student/StudentHome';
import { TestPortal } from './pages/student/TestPortal';
import { CoachHome } from './pages/coach/CoachHome';
import { WaiverPage } from './pages/WaiverPage';

const Router = __DEMO_BUILD__ ? MemoryRouter : BrowserRouter;

function Home() {
  const user = useUser();
  return <Navigate to={homeFor(user)} replace />;
}

export function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/waiver/:competitorId" element={<WaiverPage />} />
        <Route path="/staff" element={<StaffLayout />}>
          <Route index element={<Overview />} />
          <Route path="roster" element={<Roster />} />
          <Route path="check-in" element={<CheckIn />} />
          <Route path="people" element={<People />} />
          <Route path="rounds" element={<Rounds />} />
          <Route path="proctoring" element={<Proctoring />} />
          <Route path="grading" element={<Grading />} />
          <Route path="results" element={<Results />} />
          <Route path="certificates" element={<Certificates />} />
          <Route path="emails" element={<Emails />} />
        </Route>
        <Route path="/coach" element={<CoachHome />} />
        <Route path="/me" element={<StudentHome />} />
        <Route path="/me/test/:roundId" element={<TestPortal />} />
        <Route path="*" element={<Home />} />
      </Routes>
      <Toasts />
      <DemoPill />
    </Router>
  );
}
