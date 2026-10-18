import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "../api";

export default function Layout() {
  const navigate = useNavigate();
  const auth = JSON.parse(localStorage.getItem("auth") || "null");
  const isAdmin = auth?.role === "admin";
  const isLive = auth?.role === "live";
  const isAmbulance = auth?.role === "ambulance";
  const links = isAdmin ? [
    ["/admin", "Dashboard", "⌂"],
    ["/admin/command-centre", "Command Centre", "◉"],
    ["/admin/dispatch", "Dispatch Planner", "↗"],
    ["/admin/facilities", "Facilities", "✚"],
    ["/ambulances", "Ambulances", "🚑"],
    ["/ambulance", "Ambulance Simulation", "➜"],
  ] : isAmbulance ? [
    ["/ambulance", "Ambulance Unit", "🚑"],
  ] : isLive ? [
    ["/live", "Video Feed", "▶"],
  ] : [
    ["/hospital-dashboard", "Live Alerts", "!"],
    ["/hospital/resources", "Resources", "+"],
    ["/hospital/history", "Accident History", "↺"],
    ["/ambulances", "Ambulances", "🚑"],
  ];

  async function logout() {
    try { await api.auth.logout(); } catch (_) {}
    localStorage.removeItem("auth");
    navigate("/login");
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">AR</div><div><strong>Accident Response</strong><span>{isAdmin ? "Admin Analytics" : isLive ? "Live Feed Operator" : isAmbulance ? "Ambulance Operator" : auth?.hospital_name}</span></div></div>
      <nav className="nav">{links.map(([to,label,icon]) => <NavLink key={to} to={to} className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}><span className="nav-icon">{icon}</span>{label}</NavLink>)}</nav>
      <div className="sidebar-footer"><div className="system-status"><span className="status-dot online" />System online</div><button className="logout-button" onClick={logout}>Logout</button></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div><span className="eyebrow">{isAdmin ? "ADMIN CONTROL CENTER" : isLive ? "LIVE VIDEO FEED" : isAmbulance ? "AMBULANCE OPERATIONS" : "HOSPITAL EMERGENCY DESK"}</span><h1>{isAdmin ? "System Summary" : isLive ? "Live Video Intake" : isAmbulance ? "Ambulance Unit Console" : auth?.hospital_name}</h1></div><div className="topbar-right"><span className="live-pill"><span className="status-dot online" /> LIVE</span></div></header>
      <div className="page-content"><Outlet /></div>
    </main>
  </div>;
}
