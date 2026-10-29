import { useState } from "react";
import { Link, useNavigate, useLocation as useRouteLocation } from "react-router-dom";
import { useAppContext } from "../../context/AppContext";
import { CATEGORIES } from "../../data/appData";

export default function Nav() {
  const { user, location, logoutFn, showToast, authHydrated } = useAppContext();
  const navigate = useNavigate();
  const pathname = useRouteLocation().pathname;
  const [searchQ, setSearchQ] = useState("");

  function handleSearch(e) {
    if (e.key === "Enter" && searchQ.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQ.trim())}`);
    }
  }

  return (
      <nav
          className="nav"
          style={{
              background: "rgba(255, 255, 255, 0.15)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              border: "1px solid rgba(255,255,255,0.2)",
              boxShadow: "0 8px 32px rgba(0,0,0,0.1)",
              borderRadius: "12px",
          }}
      >
          <Link to="/" className="nav-logo" style={{textDecoration: "none"}}>
              Click<span>n</span>Go
          </Link>
          <div className="nav-loc">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                  <circle cx="12" cy="9" r="2.5"/>
              </svg>
              {location}
          </div>
          <div className="nav-search-wrap">
        <span className="nav-search-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35"/>
          </svg>
        </span>
              <input
                  className="nav-search"
                  style={{width: "100%"}}
                  placeholder="search services..."
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  onKeyDown={handleSearch}
              />
          </div>
          <div className="nav-tabs">
              {CATEGORIES.map((c) => (
                  <Link
                      key={c.id}
                      to={`/category/${c.id}`}
                      className={`nav-tab${pathname === `/category/${c.id}` ? " active" : ""}`}
                      style={{textDecoration: "none"}}
                  >
                      {c.label}
                  </Link>
              ))}
          </div>
          <div className="nav-right" style={{ minHeight: 40, display: "flex", alignItems: "center", gap: 8 }}>
              {!authHydrated ? (
                  <span style={{ fontSize: 12, color: "var(--gray-text)", padding: "0 8px" }}>…</span>
              ) : user ? (
                  <>
                    {user.role === "ADMIN" && (
                      <button className="nav-btn" onClick={() => navigate("/admin/dashboard")}>
                          Admin Dashboard
                      </button>
                    )}
                    {user.role === "PROVIDER" && (
                      <button className="nav-btn" onClick={() => navigate("/provider")}>
                          List Business
                      </button>
                    )}
                    <div className="nav-user" onClick={() => navigate("/profile")}>
                        <div className="nav-avatar">{(user.name || "U")[0]}</div>
                        <span style={{fontSize: 13, fontWeight: 500}}>{(user.name || "User").split(" ")[0]}</span>
                    </div>
                    <button
                      className="nav-btn"
                      onClick={() => {
                        logoutFn();
                        showToast("Logged out successfully");
                        navigate("/login");
                      }}
                    >
                      Logout
                    </button>
                  </>
              ) : (
                  <>
                      <button className="nav-btn" onClick={() => navigate("/admin/login")}>
                          Admin
                      </button>
                      <button className="nav-btn" onClick={() => navigate("/login")}>
                          Login
                      </button>
                      <button className="nav-btn primary" onClick={() => navigate("/signup")}>
                          Sign Up
                      </button>
                  </>
              )}
          </div>
      </nav>
  );
}
