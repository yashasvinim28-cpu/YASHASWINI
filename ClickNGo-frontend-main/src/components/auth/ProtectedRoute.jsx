import { Navigate } from "react-router-dom";
import { useAppContext } from "../../context/AppContext";

export function ProviderRoute({ children }) {
  const { user, authHydrated } = useAppContext();

  if (!authHydrated) {
    return (
      <div className="page" style={{ color: "var(--white)", textAlign: "center", padding: 100 }}>
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "PROVIDER") return <Navigate to="/" replace />;
  return children;
}

/** Booking UI: providers cannot book; customers and guests can. */
export function CustomerBookingRoute({ children }) {
  const { user, authHydrated } = useAppContext();

  if (!authHydrated) {
    return (
      <div className="page" style={{ color: "var(--white)", textAlign: "center", padding: 100 }}>
        Loading…
      </div>
    );
  }
  if (user?.role === "PROVIDER") return <Navigate to="/provider/dashboard" replace />;
  return children;
}

export function AdminRoute({ children }) {
  const { user, authHydrated } = useAppContext();

  if (!authHydrated) {
    return (
      <div className="page" style={{ color: "var(--white)", textAlign: "center", padding: 100 }}>
        Loading...
      </div>
    );
  }
  if (!user) return <Navigate to="/admin/login" replace />;
  if (user.role !== "ADMIN") return <Navigate to="/" replace />;
  return children;
}
