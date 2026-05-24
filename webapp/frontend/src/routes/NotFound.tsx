import { Link } from "react-router-dom";
import { SeoHead } from "../components/SeoHead";

export function NotFound() {
  return (
    <div style={{ padding: "32px", textAlign: "center" }}>
      <SeoHead
        title="Not found"
        description="The page you were looking for does not exist on vibeshub."
        noindex
      />
      <h1>Not found</h1>
      <p>
        <Link to="/">Back to vibeshub</Link>
      </p>
    </div>
  );
}
