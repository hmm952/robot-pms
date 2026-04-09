import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { ProjectProvider } from './context/ProjectContext.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import OverviewPage from './pages/OverviewPage.jsx';
import TasksPage from './pages/TasksPage.jsx';
import TaskDetailPage from './pages/TaskDetailPage.jsx';
import ReviewsPage from './pages/ReviewsPage.jsx';
import ReviewDetailPage from './pages/ReviewDetailPage.jsx';
import ContractsPage from './pages/ContractsPage.jsx';
import ContractDetailPage from './pages/ContractDetailPage.jsx';
import KpiPage from './pages/KpiPage.jsx';
import CompetitorsPage from './pages/CompetitorsPage.jsx';
import PlanMilestonePage from './pages/PlanMilestonePage.jsx';
import MeetingRagPage from './pages/MeetingRagPage.jsx';
import RagConfigPage from './pages/RagConfigPage.jsx';
import NotificationCenterPage from './pages/NotificationCenterPage.jsx';

function Protected({ children }) {
  const { token, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" />
      </div>
    );
  }
  if (!token) return <Navigate to="/login" replace />;
  return <ProjectProvider>{children}</ProjectProvider>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="tasks/:id" element={<TaskDetailPage />} />
        <Route path="plan" element={<PlanMilestonePage />} />
        <Route path="reviews" element={<ReviewsPage />} />
        <Route path="reviews/:id" element={<ReviewDetailPage />} />
        <Route path="contracts" element={<ContractsPage />} />
        <Route path="contracts/:id" element={<ContractDetailPage />} />
        <Route path="kpi" element={<KpiPage />} />
        <Route path="meetings" element={<MeetingRagPage />} />
        <Route path="settings/rag" element={<RagConfigPage />} />
        <Route path="settings/notify" element={<NotificationCenterPage />} />
        <Route path="competitors" element={<CompetitorsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
