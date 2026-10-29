import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AppProvider, useAppContext } from "./context/AppContext";
import { STYLE } from "./styles/globalStyles";
import Nav from "./components/layout/Nav";
import { useNotifications } from "./hooks/useNotifications";

import SplashPage from "./pages/SplashPage";
import HomePage from "./pages/HomePage";
import CategoryPage from "./pages/CategoryPage";
import DetailPage from "./pages/DetailPage";
import PaymentPage from "./pages/PaymentPage";
import ConfirmPage from "./pages/ConfirmPage";
import ProfilePage from "./pages/ProfilePage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import ReviewsPage from "./pages/ReviewsPage";
import SearchPage from "./pages/SearchPage";
import NotFoundPage from "./pages/NotFoundPage";
import ProviderLandingPage from "./pages/provider/ProviderLandingPage";
import ProviderRegisterPage from "./pages/provider/ProviderRegisterPage";
import ProviderDashboardPage from "./pages/provider/ProviderDashboardPage";
import ServiceCreationPage from "./pages/provider/ServiceCreationPage";
import ManageServicePage from "./pages/provider/ManageServicePage";
import AdminLoginPage from "./pages/AdminLoginPage";
import AdminDashboardPage from "./pages/AdminDashboardPage";
import { AdminRoute, ProviderRoute } from "./components/auth/ProtectedRoute";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [pathname]);
  return null;
}

function Toast() {
  const { toastMsg } = useAppContext();
  return toastMsg ? <div className="toast">{toastMsg}</div> : null;
}

function AppContent() {
  const [showSplash, setShowSplash] = useState(true);
  const { user, showToast } = useAppContext();
  useNotifications(user, showToast);

  return (
    <>
      {showSplash && <SplashPage onDone={() => setShowSplash(false)} />}
      <Nav />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/category/:catId" element={<CategoryPage />} />
        <Route path="/detail/:id" element={<DetailPage />} />
        <Route path="/payment" element={<PaymentPage />} />
        <Route path="/confirm" element={<ConfirmPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/reviews" element={<ReviewsPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/provider" element={<ProviderLandingPage />} />
        <Route path="/provider/register" element={<ProviderRegisterPage />} />
        <Route
          path="/admin/dashboard"
          element={
            <AdminRoute>
              <AdminDashboardPage />
            </AdminRoute>
          }
        />
        <Route
          path="/provider/service/create"
          element={
            <ProviderRoute>
              <ServiceCreationPage />
            </ProviderRoute>
          }
        />
        <Route
          path="/provider/dashboard"
          element={
            <ProviderRoute>
              <ProviderDashboardPage />
            </ProviderRoute>
          }
        />
        <Route
          path="/provider/services/:serviceId"
          element={
            <ProviderRoute>
              <ManageServicePage />
            </ProviderRoute>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <Toast />
    </>
  );
}

export default function App() {
  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = STYLE;
    document.head.appendChild(el);
    return () => el.remove();
  }, []);

  return (
    <BrowserRouter>
      <AppProvider>
        <ScrollToTop />
        <AppContent />
      </AppProvider>
    </BrowserRouter>
  );
}
