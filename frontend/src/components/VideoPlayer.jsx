export default function VideoPlayer({ src, title = "Accident evidence" }) {
  if (!src) {
    return (
      <div className="video-placeholder">
        <span>VIDEO</span>
        <p>No video evidence is attached to this incident.</p>
      </div>
    );
  }

  const normalizedSrc = src.startsWith("http")
    ? src
    : `/${src.replace(/^\/+/, "")}`;

  return (
    <div className="video-container">
      <video controls preload="metadata" src={normalizedSrc}>
        Your browser does not support video playback.
      </video>
      <small>{title}</small>
    </div>
  );
}
