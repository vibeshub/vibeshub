import { useEffect, useState } from "react";
import { ApiError, fetchMyRepos, fetchRepoPrs } from "../api";
import type { GithubPickerPr, GithubPickerRepo } from "../types";
import styles from "./RepoPrPicker.module.css";

/** The selection the picker reports to its parent. */
export type PickerSelection =
  | { kind: "none" }
  | { kind: "repo"; repoFullName: string }
  | { kind: "pr"; prUrl: string; repoFullName: string };

interface RepoPrPickerProps {
  value: PickerSelection;
  onChange: (selection: PickerSelection) => void;
  /** Disable all inputs (e.g. while a parent request is in flight). */
  disabled?: boolean;
}

const DEBOUNCE_MS = 250;
const MAX_RESULTS = 10;

function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.body || `Request failed (${e.status})`;
  return e instanceof Error ? e.message : String(e);
}

export function RepoPrPicker({
  value,
  onChange,
  disabled,
}: RepoPrPickerProps) {
  const [repoQuery, setRepoQuery] = useState("");
  const [repoResults, setRepoResults] = useState<GithubPickerRepo[]>([]);
  const [chosenRepo, setChosenRepo] = useState<string | null>(
    value.kind === "none" ? null : value.repoFullName,
  );
  const [prQuery, setPrQuery] = useState("");
  const [prResults, setPrResults] = useState<GithubPickerPr[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced repo search (only while no repo is chosen).
  useEffect(() => {
    if (chosenRepo) return;
    const q = repoQuery.trim();
    if (!q) {
      setRepoResults([]);
      return;
    }
    let ignore = false;
    const handle = setTimeout(() => {
      setLoading(true);
      setError(null);
      fetchMyRepos(q)
        .then((repos) => {
          if (!ignore) setRepoResults(repos.slice(0, MAX_RESULTS));
        })
        .catch((e) => {
          if (!ignore) setError(errMessage(e));
        })
        .finally(() => {
          if (!ignore) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      ignore = true;
      clearTimeout(handle);
    };
  }, [repoQuery, chosenRepo]);

  // Debounced PR search (only once a repo is chosen). An empty query is
  // intentional here: selecting a repo lists its recent PRs immediately so
  // the user can pick one without typing — unlike the repo search above,
  // which has no useful "recent" list to show before a query is entered.
  useEffect(() => {
    if (!chosenRepo) return;
    let ignore = false;
    const handle = setTimeout(() => {
      setLoading(true);
      setError(null);
      fetchRepoPrs(chosenRepo, prQuery.trim())
        .then((prs) => {
          if (!ignore) setPrResults(prs.slice(0, MAX_RESULTS));
        })
        .catch((e) => {
          if (!ignore) setError(errMessage(e));
        })
        .finally(() => {
          if (!ignore) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      ignore = true;
      clearTimeout(handle);
    };
  }, [prQuery, chosenRepo]);

  function selectRepo(repo: GithubPickerRepo) {
    setChosenRepo(repo.full_name);
    setRepoResults([]);
    setPrQuery("");
    setPrResults([]);
    setError(null);
    onChange({ kind: "repo", repoFullName: repo.full_name });
  }

  function selectPr(pr: GithubPickerPr) {
    if (!chosenRepo) return;
    setPrResults([]);
    onChange({
      kind: "pr",
      prUrl: pr.html_url,
      repoFullName: chosenRepo,
    });
  }

  function clear() {
    setChosenRepo(null);
    setRepoQuery("");
    setRepoResults([]);
    setPrQuery("");
    setPrResults([]);
    setError(null);
    onChange({ kind: "none" });
  }

  return (
    <div className={styles.picker}>
      {!chosenRepo && (
        <div className={styles.stage}>
          <input
            type="text"
            className={styles.search}
            placeholder="Search your repositories…"
            value={repoQuery}
            disabled={disabled}
            onChange={(e) => setRepoQuery(e.target.value)}
          />
          {repoResults.length > 0 && (
            <ul className={styles.results}>
              {repoResults.map((repo) => (
                <li key={repo.full_name}>
                  <button
                    type="button"
                    className={styles.result}
                    disabled={disabled}
                    onClick={() => selectRepo(repo)}
                  >
                    <span>{repo.full_name}</span>
                    {repo.private && (
                      <span
                        className={styles.lock}
                        aria-label="private"
                        title="private"
                      >
                        🔒
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {chosenRepo && (
        <div className={styles.stage}>
          <div className={styles.chip}>
            <span className={styles.chipLabel}>{chosenRepo}</span>
            <button
              type="button"
              className={styles.clear}
              disabled={disabled}
              onClick={clear}
            >
              Clear (make standalone)
            </button>
          </div>
          {value.kind === "pr" && (
            <p className={styles.note}>
              Linked PR:{" "}
              <a href={value.prUrl} target="_blank" rel="noreferrer">
                {value.prUrl}
              </a>
            </p>
          )}
          <input
            type="text"
            className={styles.search}
            placeholder="Search pull requests in this repo (optional)…"
            value={prQuery}
            disabled={disabled}
            onChange={(e) => setPrQuery(e.target.value)}
          />
          {prResults.length > 0 && (
            <ul className={styles.results}>
              {prResults.map((pr) => (
                <li key={pr.number}>
                  <button
                    type="button"
                    className={styles.result}
                    disabled={disabled}
                    onClick={() => selectPr(pr)}
                  >
                    #{pr.number} {pr.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {loading && <p className={styles.note}>Searching…</p>}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
