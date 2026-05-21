import { useLocation } from "react-router-dom";

interface Props {
  kind: "signin" | "enable";
}

/**
 * Shown when a private trace cannot be displayed: either the viewer is
 * signed out (`signin`), or signed in without the `repo` scope (`enable`).
 * Both route through the GitHub OAuth login; `enable` adds `scope=private`
 * to request the broader scope needed to read private repos.
 */
export function PrivateTraceGate({ kind }: Props) {
  const location = useLocation();
  const next = encodeURIComponent(location.pathname + location.search);
  const href =
    kind === "enable"
      ? `/api/auth/github/login?scope=private&next=${next}`
      : `/api/auth/github/login?next=${next}`;

  return (
    <div className="private-gate" role="status">
      <h2>🔒 This trace is private</h2>
      {kind === "signin" ? (
        <p>
          This trace belongs to a private repository. Sign in with GitHub
          to view it — you'll only see it if your GitHub account can access
          the repository.
        </p>
      ) : (
        <p>
          To view private-repository traces, GitHub needs to grant vibeshub
          access to your repositories. GitHub will ask for read/write access
          to your private repos — vibeshub only ever reads them.
        </p>
      )}
      <a className="iconbtn primary" href={href}>
        {kind === "enable"
          ? "Enable private repositories"
          : "Sign in with GitHub"}
      </a>
    </div>
  );
}
