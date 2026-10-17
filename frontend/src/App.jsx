import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import AdminDashboard from "./pages/AdminDashboard";
import HospitalDashboard from "./pages/HospitalDashboard";
import HospitalResources from "./pages/HospitalResources";
import HospitalHistory from "./pages/HospitalHistory";
import HospitalIncidentDetails from "./pages/HospitalIncidentDetails";
import LiveDashboard from "./pages/LiveDashboard";
import DispatchPlanner from "./pages/DispatchPlanner";
import Ambulances from "./pages/Ambulances";
import Hospitals from "./pages/Hospitals";
import CommandCentre from "./pages/CommandCentre";

function Guard({ role, children }) {
  const auth = JSON.parse(localStorage.getItem("auth") || "null");
  if (!auth?.authenticated) return <Navigate to="/login" replace />;
  if (role && auth.role !== role) return <Navigate to={auth.role === "admin" ? "/admin" : auth.role === "live" ? "/live" : "/hospital-dashboard"} replace />;
  return children;
}

export default function App() {
  return <Routes>
    <Route path="/login" element={<Login />} />
    <Route element={<Layout />}>
      <Route path="/admin" element={<Guard role="admin"><AdminDashboard /></Guard>} />
      <Route path="/admin/command-centre" element={<Guard role="admin"><CommandCentre /></Guard>} />
      <Route path="/admin/dispatch" element={<Guard role="admin"><DispatchPlanner /></Guard>} />
      <Route path="/admin/facilities" element={<Guard role="admin"><Hospitals /></Guard>} />
      <Route path="/ambulances" element={<Guard><Ambulances /></Guard>} />
      <Route path="/hospital-dashboard" element={<Guard role="hospital"><HospitalDashboard /></Guard>} />
      <Route path="/live" element={<Guard role="live"><LiveDashboard /></Guard>} />
      <Route path="/hospital/resources" element={<Guard role="hospital"><HospitalResources /></Guard>} />
      <Route path="/hospital/history" element={<Guard role="hospital"><HospitalHistory /></Guard>} />
      <Route path="/hospital/incidents/:id" element={<Guard role="hospital"><HospitalIncidentDetails /></Guard>} />
    </Route>
    <Route path="*" element={<Navigate to="/login" replace />} />
  </Routes>;
}
