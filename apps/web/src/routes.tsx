import { createRootRoute, createRoute, Outlet, redirect } from '@tanstack/react-router';
import { checkAuth } from './api/client';
import { LoginPage } from './routes/login';
import { DashboardPage } from './routes/index';
import { RunListPage } from './routes/runs/index';
import { RunDetailPage } from './routes/runs/$runId/index';
import { AuditPage } from './routes/runs/$runId/audit';
import { MemoryPage } from './routes/memory/index';
import { AgentsPage } from './routes/agents/$harnessId';
import { ConnectorsPage } from './routes/connectors/$harnessId';
import { AnalyticsPage } from './routes/analytics/$harnessId';

const rootRoute = createRootRoute({
  component: function RootLayout() {
    return <Outlet />;
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth',
  beforeLoad: async () => {
    const ok = await checkAuth();
    if (!ok) throw redirect({ to: '/login' });
  },
  component: function AuthLayout() {
    return <Outlet />;
  },
});

const indexRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/',
  component: DashboardPage,
});

const runsRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/runs',
  component: RunListPage,
});

const runDetailRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/runs/$runId',
  component: RunDetailPage,
});

const auditRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/runs/$runId/audit',
  component: AuditPage,
});

const memoryRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/memory',
  component: MemoryPage,
});

const agentsRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/agents/$harnessId',
  component: AgentsPage,
});

const connectorsRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/connectors/$harnessId',
  component: ConnectorsPage,
});

const analyticsRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/analytics/$harnessId',
  component: AnalyticsPage,
});

export const routeTree = rootRoute.addChildren([
  loginRoute,
  authRoute.addChildren([
    indexRoute,
    runsRoute,
    runDetailRoute,
    auditRoute,
    memoryRoute,
    agentsRoute,
    connectorsRoute,
    analyticsRoute,
  ]),
]);
