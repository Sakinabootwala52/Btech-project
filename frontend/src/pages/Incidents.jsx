import {
  useEffect,
  useState,
} from "react";

import {
  Link,
  useParams,
} from "react-router-dom";

import { api } from "../api";

import Loading from "../components/Loading";
import ErrorMessage from "../components/ErrorMessage";
import StatusBadge from "../components/StatusBadge";
import VideoPlayer from "../components/VideoPlayer";
import MapView from "../components/MapView";

import {
  formatConfidence,
  formatDate,
} from "../utils";


export default function IncidentDetails() {

  const { id } =
    useParams();


  const [incident, setIncident] =
    useState(null);

  const [hospital, setHospital] =
    useState(null);

  const [error, setError] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [dispatching, setDispatching] =
    useState(false);


  // ==========================================================
  // LOAD INCIDENT
  // ==========================================================

  async function loadIncident() {

    try {
      setError("");

      const data =
        await api.incidents.get(
          id
        );

      setIncident(data);


      // Load available hospitals so we can
      // identify the assigned hospital.

      try {

        const hospitals =
          await api.hospitals.available();

        const assigned =
          hospitals.find(
            (item) =>
              item.hospital_id ===
              data.hospital_id
          );

        setHospital(
          assigned || null
        );

      } catch {
        setHospital(null);
      }

    } catch (err) {

      setError(
        err.message
      );

    } finally {

      setLoading(false);
    }
  }


  useEffect(() => {
    loadIncident();
  }, [id]);


  // ==========================================================
  // STATUS UPDATE
  // ==========================================================

  async function updateStatus(
    status
  ) {

    try {

      setError("");

      await api.incidents.updateStatus(
        id,
        status
      );

      await loadIncident();

    } catch (err) {

      setError(
        err.message
      );
    }
  }


  // ==========================================================
  // DISPATCH AMBULANCE
  // ==========================================================

  async function dispatchAmbulance() {

    try {

      setDispatching(true);
      setError("");

      await api.incidents.dispatch(
        id
      );

      await loadIncident();

    } catch (err) {

      setError(
        err.message
      );

    } finally {

      setDispatching(false);
    }
  }


  // ==========================================================
  // LOADING
  // ==========================================================

  if (loading) {

    return (
      <Loading
        label="Loading incident..."
      />
    );
  }


  if (!incident) {

    return (
      <ErrorMessage
        message={
          error ||
          "Incident not found."
        }
      />
    );
  }


  const status =
    incident.status;


  const canDispatch =
    status ===
    "RESPONSE_ACCEPTED";


  const canGoEnRoute =
    status ===
    "DISPATCHED";


  const canMarkArrived =
    status ===
    "EN_ROUTE";


  const canResolve =
    status ===
    "ARRIVED";


  const latitude =
    incident.latitude;

  const longitude =
    incident.longitude;


  return (
    <section>

      {/* ==================================================== */}
      {/* HEADER                                               */}
      {/* ==================================================== */}

      <div className="page-heading">

        <div>

          <span className="eyebrow">
            INCIDENT DETAILS
          </span>

          <h2>
            {incident.incident_id}
          </h2>

          <p>
            {formatDate(
              incident.timestamp
            )}
          </p>

        </div>


        <StatusBadge
          status={status}
        />

      </div>


      <ErrorMessage
        message={error}
      />


      {/* ==================================================== */}
      {/* INCIDENT SUMMARY                                    */}
      {/* ==================================================== */}

      <div className="content-grid two-thirds">

        {/* VIDEO */}

        <div className="panel">

          <div className="panel-header">

            <div>

              <h3>
                Video evidence
              </h3>

              <span>
                Generated accident clip
              </span>

            </div>

          </div>


          {incident.video_clip ? (
            <VideoPlayer
              src={
                incident.video_clip
              }
            />
          ) : (
            <div className="empty-state">
              No evidence video available.
            </div>
          )}

        </div>


        {/* SUMMARY */}

        <div className="panel">

          <div className="panel-header">

            <div>

              <h3>
                Incident summary
              </h3>

              <span>
                Detection and response information
              </span>

            </div>

          </div>


          <div className="detail-list">

            <Detail
              label="Confidence"
              value={
                formatConfidence(
                  incident.confidence
                )
              }
            />

            <Detail
              label="Severity"
              value={
                incident.severity?.level ||
                "UNKNOWN"
              }
            />

            <Detail
              label="Camera"
              value={
                incident.camera_id ||
                "UNKNOWN"
              }
            />

            <Detail
              label="Hospital"
              value={
                hospital?.name ||
                incident.hospital_id ||
                "Not assigned"
              }
            />

            <Detail
              label="Response"
              value={
                incident.hospital_response ||
                "PENDING"
              }
            />

            <Detail
              label="Ambulance"
              value={
                incident.ambulance_status ||
                "NOT ASSIGNED"
              }
            />

            {incident.ambulance_type && (
              <Detail
                label="Ambulance type"
                value={
                  incident.ambulance_type
                }
              />
            )}

            <Detail
              label="Beds snapshot"
              value={
                incident.resource_snapshot
                  ?.beds_available ??
                "—"
              }
            />

          </div>

        </div>

      </div>


      {/* ==================================================== */}
      {/* RESPONSE WORKFLOW                                   */}
      {/* ==================================================== */}

      <div className="panel">

        <div className="panel-header">

          <div>

            <span className="eyebrow">
              EMERGENCY RESPONSE
            </span>

            <h3>
              Ambulance workflow
            </h3>

          </div>

        </div>


        <div className="stats-grid">

          <WorkflowCard
            title="Incident"
            text="DETECTED"
            active
          />

          <WorkflowCard
            title="Hospital"
            text="ACCEPTED"
            active={[
              "RESPONSE_ACCEPTED",
              "DISPATCHED",
              "EN_ROUTE",
              "ARRIVED",
              "RESOLVED",
            ].includes(status)}
          />

          <WorkflowCard
            title="Ambulance"
            text="DISPATCHED"
            active={[
              "DISPATCHED",
              "EN_ROUTE",
              "ARRIVED",
              "RESOLVED",
            ].includes(status)}
          />

          <WorkflowCard
            title="Ambulance"
            text="EN ROUTE"
            active={[
              "EN_ROUTE",
              "ARRIVED",
              "RESOLVED",
            ].includes(status)}
          />

          <WorkflowCard
            title="Ambulance"
            text="ARRIVED"
            active={[
              "ARRIVED",
              "RESOLVED",
            ].includes(status)}
          />

          <WorkflowCard
            title="Case"
            text="RESOLVED"
            active={
              status ===
              "RESOLVED"
            }
          />

        </div>


        {/* ================================================== */}
        {/* ACTION BUTTONS                                    */}
        {/* ================================================== */}

        <div
          className="button-row"
          style={{
            marginTop: 20,
          }}
        >

          {status === "PENDING" && (
            <>
              <button
                className="button primary"
                onClick={() =>
                  updateStatus(
                    "RESPONSE_ACCEPTED"
                  )
                }
              >
                Accept Response
              </button>

              <button
                className="button danger"
                onClick={() =>
                  updateStatus(
                    "REJECTED"
                  )
                }
              >
                Reject
              </button>
            </>
          )}


          {canDispatch && (
            <button
              className="button primary"
              disabled={dispatching}
              onClick={
                dispatchAmbulance
              }
            >
              {dispatching
                ? "Dispatching..."
                : "🚑 Dispatch Ambulance"}
            </button>
          )}


          {canGoEnRoute && (
            <button
              className="button primary"
              onClick={() =>
                updateStatus(
                  "EN_ROUTE"
                )
              }
            >
              🚑 Mark En Route
            </button>
          )}


          {canMarkArrived && (
            <button
              className="button primary"
              onClick={() =>
                updateStatus(
                  "ARRIVED"
                )
              }
            >
              📍 Mark Arrived
            </button>
          )}


          {canResolve && (
            <button
              className="button primary"
              onClick={() =>
                updateStatus(
                  "RESOLVED"
                )
              }
            >
              ✓ Mark Resolved
            </button>
          )}

        </div>

      </div>


      {/* ==================================================== */}
      {/* LOCATION                                            */}
      {/* ==================================================== */}

      {latitude != null &&
        longitude != null && (

        <div className="panel">

          <div className="panel-header">

            <div>

              <h3>
                Incident location
              </h3>

              <span>
                {latitude},{" "}
                {longitude}
              </span>

            </div>

          </div>


          <MapView
            incidents={[
              incident
            ]}
            hospitals={
              hospital
                ? [hospital]
                : []
            }
            activeIncident={
              status !== "RESOLVED"
                ? incident
                : null
            }
            height={400}
          />

        </div>
      )}


      {/* ==================================================== */}
      {/* RESPONSE DATA                                       */}
      {/* ==================================================== */}

      <div className="panel">

        <div className="panel-header">

          <div>

            <h3>
              Response information
            </h3>

            <span>
              Recorded emergency actions
            </span>

          </div>

        </div>


        <div className="detail-list">

          <Detail
            label="Accepted at"
            value={
              incident.hospital_claimed_at ||
              "—"
            }
          />

          <Detail
            label="Ambulance dispatched"
            value={
              incident.ambulance_assigned_at ||
              incident.dispatched_at ||
              "—"
            }
          />

          <Detail
            label="En route at"
            value={
              incident.en_route_at ||
              "—"
            }
          />

          <Detail
            label="Arrived at"
            value={
              incident.arrived_at ||
              "—"
            }
          />

          <Detail
            label="Resolved at"
            value={
              incident.resolved_at ||
              "—"
            }
          />

        </div>

      </div>


      <div
        className="button-row"
        style={{
          marginTop: 16,
        }}
      >

        <Link
          to="/hospital-dashboard"
          className="button secondary"
        >
          Back to Dashboard
        </Link>

      </div>

    </section>
  );
}


/* ============================================================
   DETAIL
   ============================================================ */

function Detail({
  label,
  value,
}) {
  return (
    <div className="detail-row">

      <span>
        {label}
      </span>

      <strong>
        {value}
      </strong>

    </div>
  );
}


/* ============================================================
   WORKFLOW CARD
   ============================================================ */

function WorkflowCard({
  title,
  text,
  active,
}) {
  return (
    <div
      className="stat-card"
      style={{
        opacity: active
          ? 1
          : 0.4,
      }}
    >

      <span className="stat-label">
        {title}
      </span>

      <strong
        className="stat-value"
        style={{
          fontSize: 18,
        }}
      >
        {active
          ? `✓ ${text}`
          : text}
      </strong>

    </div>
  );
}