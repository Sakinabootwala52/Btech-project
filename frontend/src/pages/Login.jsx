import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { homeFor } from "../utils";

export default function Login() {
  const navigate = useNavigate();
  const [role, setRole] = useState("hospital");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("1234");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      const data = await api.auth.login(role, username, password);
      const auth = { authenticated: true, ...data };
      localStorage.setItem("auth", JSON.stringify(auth));
      navigate(homeFor(data.role), { replace: true });
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return <div className="login-page"><div className="login-card">
    <div className="brand-mark large">AR</div>
    <span className="eyebrow">EMERGENCY OPERATIONS</span>
    <h1>Accident Response System</h1>
    <p className="muted">Sign in as a hospital responder, live video operator, ambulance operator, or system administrator.</p>

    <div className="role-switch">
      <button className={role === "hospital" ? "selected" : ""} onClick={() => setRole("hospital")}>Hospital</button>
      <button className={role === "admin" ? "selected" : ""} onClick={() => setRole("admin")}>Admin</button>
      <button className={role === "live" ? "selected" : ""} onClick={() => setRole("live")}>Live Feed</button>
      <button className={role === "ambulance" ? "selected" : ""} onClick={() => setRole("ambulance")}>Ambulance</button>
    </div>

    <form onSubmit={submit} className="form-stack">
      <label>{role === "hospital" ? "Hospital name" : role === "live" ? "Live username" : role === "ambulance" ? "Ambulance operator username" : "Admin username"}<input value={username} onChange={e => setUsername(e.target.value)} placeholder={role === "hospital" ? "City Emergency Hospital" : role === "live" ? "live" : role === "ambulance" ? "ambulance" : "admin"} required /></label>
      <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
      {role === "hospital" && <small className="login-hint">All prototype hospital passwords: 1234</small>}
      {role === "live" && <small className="login-hint">Live feed: live / 1234</small>}
      {role === "admin" && <small className="login-hint">Prototype admin: admin / 1234</small>}
      {role === "ambulance" && <small className="login-hint">Ambulance operator: ambulance / 1234</small>}
      {error && <div className="error-message"><span>{error}</span></div>}
      <button className="button primary" disabled={loading}>{loading ? "Signing in..." : "Sign in"}</button>
    </form>
    <small className="mock-label">PROTOTYPE AUTHENTICATION</small>
  </div></div>;
}
