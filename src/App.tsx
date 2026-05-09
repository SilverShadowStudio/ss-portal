import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminProtectedRoute } from "@/components/AdminProtectedRoute";
import { RootRedirect } from "@/components/RootRedirect";
import Index from "./pages/Index";
import Delivery from "./pages/Delivery";
import Portfolio from "./pages/Portfolio";
import Timeline from "./pages/Timeline";
import NewTask from "./pages/NewTask";
import Messages from "./pages/Messages";
import Total from "./pages/Total";
import Documents from "./pages/Documents";
import Account from "./pages/Account";
import Invoices from "./pages/Invoices";
import InvoicePreview from "./pages/InvoicePreview";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import Onboarding from "./pages/Onboarding";
import Contract from "./pages/Contract";
import NotFound from "./pages/NotFound";
import AcceptInvite from "./pages/AcceptInvite";
import Unsubscribe from "./pages/Unsubscribe";
import Partnership from "./pages/Partnership";
import Lanes from "./pages/Lanes";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminClients from "./pages/admin/AdminClients";
import AdminClientProfile from "./pages/admin/AdminClientProfile";
import AdminProjects from "./pages/admin/AdminProjects";
import AdminScenes from "./pages/admin/AdminScenes";
import AdminDocuments from "./pages/admin/AdminDocuments";
import AdminTimeline from "./pages/admin/AdminTimeline";
import AdminActivity from "./pages/admin/AdminActivity";
import AdminInvoices from "./pages/admin/AdminInvoices";
import AdminBatchUpload from "./pages/admin/AdminBatchUpload";
import AdminLanes from "./pages/admin/AdminLanes";
import AdminOrders from "./pages/admin/AdminOrders";
import Orders from "./pages/Orders";
import AdminProductionTracker from "./pages/admin/AdminProductionTracker";
import AdminClientActivity from "./pages/admin/AdminClientActivity";
import { useClientActivityTracker } from "@/hooks/useClientActivityTracker";
import { GhostModeBanner } from "@/components/GhostModeBanner";
import { useAuth } from "@/contexts/AuthContext";

const queryClient = new QueryClient();

function ActivityTrackerMount() {
  useClientActivityTracker();
  return null;
}

function GhostModeShell({ children }: { children: React.ReactNode }) {
  const { isGhostMode } = useAuth();
  return (
    <>
      <GhostModeBanner />
      <div className={isGhostMode ? "pt-10" : undefined}>{children}</div>
    </>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
        <Sonner />
        <BrowserRouter>
          <ActivityTrackerMount />
          <GhostModeShell>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/contract" element={<Contract />} />
            <Route path="/accept-invite" element={<AcceptInvite />} />
            <Route path="/unsubscribe" element={<Unsubscribe />} />
            <Route path="/partnership" element={<Partnership />} />
            <Route path="/invoice-preview" element={<InvoicePreview />} />
            
            {/* Client Routes */}
            <Route path="/" element={<RootRedirect />} />
            <Route
              path="/delivery"
              element={
                <ProtectedRoute>
                  <Delivery />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Index />
                </ProtectedRoute>
              }
            />
            <Route
              path="/portfolio"
              element={
                <ProtectedRoute>
                  <Portfolio />
                </ProtectedRoute>
              }
            />
            <Route
              path="/lanes"
              element={
                <ProtectedRoute>
                  <Lanes />
                </ProtectedRoute>
              }
            />
            <Route
              path="/timeline"
              element={
                <ProtectedRoute>
                  <Timeline />
                </ProtectedRoute>
              }
            />
            <Route
              path="/tasks/new"
              element={
                <ProtectedRoute>
                  <NewTask />
                </ProtectedRoute>
              }
            />
            <Route
              path="/messages"
              element={
                <ProtectedRoute>
                  <Messages />
                </ProtectedRoute>
              }
            />
            <Route
              path="/documents"
              element={
                <ProtectedRoute>
                  <Documents />
                </ProtectedRoute>
              }
            />
            <Route
              path="/account"
              element={
                <ProtectedRoute>
                  <Account />
                </ProtectedRoute>
              }
            />
            <Route
              path="/invoices"
              element={
                <ProtectedRoute>
                  <Invoices />
                </ProtectedRoute>
              }
            />
            <Route
              path="/orders"
              element={
                <ProtectedRoute>
                  <Orders />
                </ProtectedRoute>
              }
            />

            {/* Admin Routes */}
            <Route
              path="/admin"
              element={
                <AdminProtectedRoute>
                  <AdminDashboard />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/clients"
              element={
                <AdminProtectedRoute>
                  <AdminClients />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/clients/:accountId"
              element={
                <AdminProtectedRoute>
                  <AdminClientProfile />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/projects"
              element={
                <AdminProtectedRoute>
                  <AdminProjects />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/projects/:projectId"
              element={
                <AdminProtectedRoute>
                  <AdminProjects />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/scenes"
              element={
                <AdminProtectedRoute>
                  <AdminScenes />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/timeline"
              element={
                <AdminProtectedRoute>
                  <AdminTimeline />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/total"
              element={
                <AdminProtectedRoute>
                  <Total />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/documents"
              element={
                <AdminProtectedRoute>
                  <AdminDocuments />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/activity"
              element={
                <AdminProtectedRoute>
                  <AdminActivity />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/client-activity"
              element={
                <AdminProtectedRoute>
                  <AdminClientActivity />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/invoices"
              element={
                <AdminProtectedRoute>
                  <AdminInvoices />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/batch-upload"
              element={
                <AdminProtectedRoute>
                  <AdminBatchUpload />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/lanes"
              element={
                <AdminProtectedRoute>
                  <AdminLanes />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/orders"
              element={
                <AdminProtectedRoute>
                  <AdminOrders />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/production-tracker"
              element={
                <AdminProtectedRoute>
                  <AdminProductionTracker />
                </AdminProtectedRoute>
              }
            />
            
            <Route path="*" element={<NotFound />} />
          </Routes>
          </GhostModeShell>
          </BrowserRouter>
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
