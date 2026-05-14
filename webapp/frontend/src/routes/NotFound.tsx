import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div style={{ padding: "32px", textAlign: "center" }}>
      <h1>Not found</h1>
      <p>
        <Link to="/">Back to vibeshub</Link>
      </p>
    </div>
  );
}
