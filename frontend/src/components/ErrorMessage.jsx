export default function ErrorMessage({ message }) {
  if (!message) return null;

  return (
    <div className="error-message">
      <strong>Unable to load data</strong>
      <span>{message}</span>
    </div>
  );
}
