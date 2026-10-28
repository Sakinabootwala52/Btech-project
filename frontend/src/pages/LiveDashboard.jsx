import { useEffect, useRef, useState } from "react";
import { api, API_BASE_URL } from "../api";

const SAMPLE_VIDEOS = Array.from(
  { length: 11 },
  (_, index) =>
    `clip_${String(index + 1).padStart(2, "0")}.mp4`
);

export default function LiveDashboard() {
  const [cameraId, setCameraId] = useState("CAM_001");
  const [source, setSource] = useState("clip_01.mp4");
  const [cameras, setCameras] = useState([]);
  const [cameraLoadError, setCameraLoadError] = useState("");

  const [streamId, setStreamId] = useState(null);
  const [streamStatus, setStreamStatus] = useState("idle");

  const [framesProcessed, setFramesProcessed] = useState(0);
  const [lastTimestamp, setLastTimestamp] = useState(0);

  const [accidentDetected, setAccidentDetected] = useState(false);
  const [lastDetection, setLastDetection] = useState(null);
  const [events, setEvents] = useState([]);

  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  const [error, setError] = useState("");

  const pollingRef = useRef(null);

  function clearPolling() {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }

  async function getStreamStatus(id) {
    try {
      const response = await fetch(
        `${API_BASE_URL}/live/stream/${id}`,
        {
          credentials: "include",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.error ||
            "Could not get stream status."
        );
      }

      setStreamStatus(data.status || "unknown");

      setFramesProcessed(
        data.frames_processed ?? 0
      );

      setLastTimestamp(
        data.last_timestamp ?? 0
      );

      setAccidentDetected(
        Boolean(data.accident_detected)
      );

      setLastDetection(
        data.last_detection ?? null
      );

      setEvents(
        Array.isArray(data.events)
          ? data.events
          : []
      );

      // Stop polling once the simulated video ends.
      if (
        data.status === "completed" ||
        data.status === "stopped"
      ) {
        clearPolling();
      }

      return data;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }

  function startPolling(id) {
    clearPolling();

    // Get status immediately.
    getStreamStatus(id);

    pollingRef.current = setInterval(() => {
      getStreamStatus(id);
    }, 1000);
  }

  async function startStream() {
    setStarting(true);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/live/stream/start`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            camera_id: cameraId,
            source,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.error ||
            "Could not start stream."
        );
      }

      setStreamId(data.stream_id);
      setStreamStatus(data.status || "starting");

      setFramesProcessed(0);
      setLastTimestamp(0);
      setAccidentDetected(false);
      setLastDetection(null);
      setEvents([]);

      startPolling(data.stream_id);
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }

  async function stopStream() {
    if (!streamId) return;

    setStopping(true);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/live/stream/${streamId}/stop`,
        {
          method: "POST",
          credentials: "include",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.error ||
            "Could not stop stream."
        );
      }

      setStreamStatus("stopped");
      clearPolling();
    } catch (err) {
      setError(err.message);
    } finally {
      setStopping(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadCameras() {
      try {
        const rows = await api.cameras.list();
        if (cancelled) return;
        const configured = Array.isArray(rows) ? rows : [];
        setCameras(configured);
        setCameraLoadError("");
        setCameraId((current) =>
          configured.some((camera) => camera.camera_id === current)
            ? current
            : (configured[0]?.camera_id || "")
        );
      } catch (err) {
        if (!cancelled) setCameraLoadError(err.message || "Could not load configured cameras.");
      }
    }

    loadCameras();
    const cameraRefresh = window.setInterval(loadCameras, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(cameraRefresh);
      clearPolling();
    };
  }, []);

  const isRunning =
    streamStatus === "starting" ||
    streamStatus === "running";

  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            REAL-TIME STREAM
          </span>

          <h2>
            CCTV Stream Monitoring
          </h2>

          <p>
            Start a simulated CCTV stream and let
            the ML pipeline process frames
            continuously in the background.
          </p>
        </div>

        <span className="live-pill">
          <span
            className={`status-dot ${
              isRunning ? "online" : ""
            }`}
          />

          {isRunning
            ? "STREAMING"
            : "STANDBY"}
        </span>
      </div>

      {error && (
        <div className="error-message">
          <span>{error}</span>
        </div>
      )}
      {cameraLoadError && (
        <div className="error-message"><span>{cameraLoadError}</span></div>
      )}

      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header">
          <div>
            <h3>Configured cameras ({cameras.length})</h3>
          </div>
        </div>
        {cameras.length === 0 ? (
          <p></p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
            {cameras.map((camera) => (
              <button
                type="button"
                key={camera.camera_id}
                className="panel"
                onClick={() => {
                  if (!isRunning) {
                    setCameraId(camera.camera_id);
                    if (camera.stream_url && SAMPLE_VIDEOS.includes(camera.stream_url)) setSource(camera.stream_url);
                  }
                }}
                style={{ textAlign: "left", cursor: isRunning ? "default" : "pointer", border: cameraId === camera.camera_id ? "2px solid var(--accent, #16a34a)" : undefined }}
              >
                <strong>{camera.name || camera.camera_id}</strong>
                <div>{camera.camera_id} · {camera.status || "UNKNOWN"}</div>
                <small>{camera.location_name || "Location not set"}</small>
                <div><small>{camera.source_type === "SIMULATED_VIDEO" ? "SIMULATED VIDEO" : (camera.source_type || "CONFIGURED SOURCE")}</small></div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* -------------------------------------------------- */}
      {/* STREAM CONTROLS                                   */}
      {/* -------------------------------------------------- */}

      <div
        className="panel"
        style={{ maxWidth: 760 }}
      >
        <div className="panel-header">
          <div>
            <h3>
              Camera stream
            </h3>

            
          </div>
        </div>

        <div className="form-stack">
          <label>
            Camera ID

            <select
              value={cameraId}
              onChange={(e) => setCameraId(e.target.value)}
              disabled={isRunning || cameras.length === 0}
              required
            >
              {cameras.map((camera) => (
                <option key={camera.camera_id} value={camera.camera_id}>
                  {camera.camera_id} — {camera.name || camera.location_name}
                </option>
              ))}
            </select>
          </label>

          <label>
            CCTV source

            <select
              value={source}
              onChange={(e) =>
                setSource(e.target.value)
              }
              disabled={isRunning}
            >
              {SAMPLE_VIDEOS.map((video) => (
                <option
                  key={video}
                  value={video}
                >
                  {video}
                </option>
              ))}
            </select>
          </label>

          <div className="button-row">
            <button
              type="button"
              className="button primary"
              onClick={startStream}
              disabled={
                starting ||
                stopping ||
                isRunning
              }
            >
              {starting
                ? "Starting stream..."
                : "Start CCTV Stream"}
            </button>

            <button
              type="button"
              className="button secondary"
              onClick={stopStream}
              disabled={
                !streamId ||
                stopping ||
                !isRunning
              }
            >
              {stopping
                ? "Stopping..."
                : "Stop Stream"}
            </button>
          </div>
        </div>
      </div>

      {/* -------------------------------------------------- */}
      {/* LIVE STATUS                                       */}
      {/* -------------------------------------------------- */}

      {streamId && (
        <div
          className="panel"
          style={{ marginTop: 18 }}
        >
          <div className="panel-header">
            <div>
              <span className="eyebrow">
                STREAM STATUS
              </span>

              <h3>
                Camera {cameraId}
              </h3>
            </div>

            <span className="live-pill">
              <span
                className={`status-dot ${
                  isRunning ? "online" : ""
                }`}
              />

              {streamStatus.toUpperCase()}
            </span>
          </div>

          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-label">
                Stream ID
              </span>

              <strong className="stat-value">
                {streamId}
              </strong>
            </div>

            <div className="stat-card">
              <span className="stat-label">
                Frames processed
              </span>

              <strong className="stat-value">
                {framesProcessed}
              </strong>
            </div>

            <div className="stat-card">
              <span className="stat-label">
                Stream time
              </span>

              <strong className="stat-value">
                {Number(lastTimestamp).toFixed(2)} s
              </strong>
            </div>

            <div className="stat-card">
              <span className="stat-label">
                Accident
              </span>

              <strong className="stat-value">
                {accidentDetected
                  ? "TRUE"
                  : "FALSE"}
              </strong>
            </div>
          </div>

          {/* ---------------------------------------------- */}
          {/* CURRENT DETECTION                             */}
          {/* ---------------------------------------------- */}

          {lastDetection && (
            <div
              className="panel"
              style={{ marginTop: 14 }}
            >
              <span className="eyebrow">
                CURRENT ML STATUS
              </span>

              <h3>
                {lastDetection.accident_detected
                  ? "Accident detected"
                  : "Monitoring normally"}
              </h3>

              <div className="stats-grid">
                <div className="stat-card">
                  <span className="stat-label">
                    Confidence
                  </span>

                  <strong className="stat-value">
                    {Number(
                      lastDetection.confidence ?? 0
                    ).toFixed(2)}
                  </strong>
                </div>

                <div className="stat-card">
                  <span className="stat-label">
                    Severity
                  </span>

                  <strong className="stat-value">
                    {lastDetection.severity
                      ?.level ||
                      "NONE"}
                  </strong>
                </div>
              </div>
            </div>
          )}

          {/* ---------------------------------------------- */}
          {/* INCIDENT EVENTS                               */}
          {/* ---------------------------------------------- */}

          {events.length > 0 && (
            <div
              className="panel"
              style={{ marginTop: 14 }}
            >
              <div className="panel-header">
                <div>
                  <span className="eyebrow">
                    ACCIDENT EVENTS
                  </span>

                  <h3>
                    {events.length} event
                    {events.length !== 1
                      ? "s"
                      : ""}
                  </h3>
                </div>
              </div>

              {events.map((event, index) => (
                <div
                  className="alert-card"
                  key={`${
                    event.camera_id
                  }-${
                    event.timestamp_seconds
                  }-${index}`}
                  style={{ marginTop: 12 }}
                >
                  <div>
                    <span className="alert-label">
                      ACCIDENT DETECTED
                    </span>

                    <h3>
                      {event.severity?.level ||
                        "UNKNOWN"}{" "}
                      severity
                    </h3>

                    <p>
                      Camera{" "}
                      {event.camera_id} ·{" "}
                      {Number(
                        event.timestamp_seconds ?? 0
                      ).toFixed(2)}
                      s · confidence{" "}
                      {Number(
                        event.confidence ?? 0
                      ).toFixed(2)}
                    </p>
                  </div>

                  {event.video_clip && (
                    <div className="button-row">
                      <a
                        className="button secondary"
                        href={`${
                          API_BASE_URL.replace(
                            /\/api$/,
                            ""
                          )
                        }${event.video_clip}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open Evidence Clip
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}