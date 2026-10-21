import { lazy } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { LoginPage } from "@/features/auth/login-page";
import { ComingSoonPage } from "@/features/coming-soon/coming-soon-page";
import { RequireAuth } from "@/app/require-auth";

const OverviewPage = lazy(() => import("@/features/overview/overview-page").then((module) => ({ default: module.OverviewPage })));
const ServicesPage = lazy(() => import("@/features/services/services-page").then((module) => ({ default: module.ServicesPage })));
const ServiceDetailPage = lazy(() => import("@/features/services/service-detail-page").then((module) => ({ default: module.ServiceDetailPage })));
const EndpointsPage = lazy(() => import("@/features/api-performance/endpoints-page").then((module) => ({ default: module.EndpointsPage })));
const EndpointDetailPage = lazy(() => import("@/features/api-performance/endpoint-detail-page").then((module) => ({ default: module.EndpointDetailPage })));
const ResourcesPage = lazy(() => import("@/features/resources/resources-page").then((module) => ({ default: module.ResourcesPage })));
const ErrorsPage = lazy(() => import("@/features/errors/errors-page").then((module) => ({ default: module.ErrorsPage })));
const AlertsPage = lazy(() => import("@/features/alerts/alerts-page").then((module) => ({ default: module.AlertsPage })));
const SettingsPage = lazy(() => import("@/features/settings/settings-page").then((module) => ({ default: module.SettingsPage })));
const InsightsPage = lazy(() => import("@/features/insights/insights-page").then((module) => ({ default: module.InsightsPage })));
const WebVitalsPage = lazy(() => import("@/features/web-vitals/web-vitals-page").then((module) => ({ default: module.WebVitalsPage })));
const ScansPage = lazy(() => import("@/features/scans/scans-page").then((module) => ({ default: module.ScansPage })));
const ScanHistoryPage = lazy(() => import("@/features/scans/scan-history-page").then((module) => ({ default: module.ScanHistoryPage })));
const ScanDetailPage = lazy(() => import("@/features/scans/scan-detail-page").then((module) => ({ default: module.ScanDetailPage })));

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/overview" replace /> },
      { path: "overview", element: <OverviewPage /> },
      { path: "services", element: <ServicesPage /> },
      { path: "services/:name", element: <ServiceDetailPage /> },
      { path: "endpoints", element: <EndpointsPage /> },
      { path: "endpoints/:key", element: <EndpointDetailPage /> },
      { path: "vitals", element: <WebVitalsPage /> },
      { path: "traces", element: <ComingSoonPage page="traces" /> },
      { path: "resources", element: <ResourcesPage /> },
      { path: "errors", element: <ErrorsPage /> },
      { path: "insights", element: <InsightsPage /> },
      { path: "scans", element: <ScansPage /> },
      { path: "scans/history", element: <ScanHistoryPage /> },
      { path: "scans/:id", element: <ScanDetailPage /> },
      { path: "alerts", element: <AlertsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <ComingSoonPage page="missing" /> },
    ],
  },
]);
