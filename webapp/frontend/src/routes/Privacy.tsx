import { Link } from "react-router-dom";
import { PageTopbar } from "../components/PageTopbar";
import { SeoHead } from "../components/SeoHead";
import styles from "./Privacy.module.css";

export function Privacy() {
  return (
    <div className="page-shell">
      <SeoHead
        title="Privacy policy"
        description="How vibeshub handles Claude Code trace uploads: what we collect, who can see it, secret redaction on the client and server, and how to delete a trace."
        path="/privacy"
      />
      <PageTopbar crumbs={[{ label: "Privacy", current: true }]} />

      <main className={styles.privacy}>
        <header className={styles.header}>
          <div className={styles.eyebrow}>
            <span className={styles.dot} />
            <span>POLICY</span>
          </div>
          <h1 className={styles.title}>Privacy policy</h1>
          <p className={styles.effective}>Effective 22 May 2026</p>
        </header>

        <article className={styles.prose}>
          <p>
            vibeshub hosts Claude Code conversation traces and links them to
            the pull requests they produced. This policy describes, in plain
            language, what we collect when you sign in and upload a trace,
            what we do with it, who can see it, and how to delete it.
          </p>

          <h2>What we collect</h2>
          <p>Three categories of data, all tied to actions you take:</p>
          <ul>
            <li>
              <strong>GitHub account data</strong> — when you sign in with
              GitHub we store your GitHub user ID, login, display name,
              avatar URL, and email (if your GitHub profile exposes one). We
              identify you by your immutable GitHub ID, so renaming your
              GitHub login does not lose your history.
            </li>
            <li>
              <strong>A GitHub OAuth access token</strong> — stored encrypted
              at rest (Fernet ciphertext). We request the minimum scopes
              needed to sign you in. The <code>repo</code> scope, which
              grants read access to your private repositories, is requested
              only if you explicitly opt into the "Enable private
              repositories" sign-in so we can check your access to
              private-repo traces on your behalf.
            </li>
            <li>
              <strong>A session cookie</strong> — an opaque, random session
              ID with an expiry. It is the only cookie we set, and it exists
              solely to keep you signed in.
            </li>
            <li>
              <strong>Uploaded traces</strong> — when you (or the Claude
              Code plugin acting on your behalf) upload a trace, we store
              the trace transcript (a JSONL file) plus the repository's full
              name, the pull request number, title, and URL, the source
              platform (e.g. <code>claude-code</code>), the plugin version,
              the Claude Code session ID, the trace's byte size and message
              count, and counts of how many secrets the redaction passes
              removed.
            </li>
          </ul>

          <h2>Redaction</h2>
          <p>
            Trace transcripts can contain anything you or Claude Code typed,
            including secrets that leaked into terminal output. Every trace
            is scrubbed in two passes — once on your machine before upload,
            and again on our server before storage — for these patterns:
          </p>
          <ul>
            <li>Anthropic API keys (<code>sk-ant-…</code>)</li>
            <li>OpenAI API keys (<code>sk-…</code>)</li>
            <li>
              GitHub tokens (<code>ghp_</code>, <code>gho_</code>,{" "}
              <code>ghu_</code>, <code>ghs_</code>, <code>ghr_</code>)
            </li>
            <li>AWS access key IDs and secret access keys</li>
            <li>JSON Web Tokens (<code>eyJ…</code>)</li>
            <li>
              Environment-style assignments of the form{" "}
              <code>FOO_KEY=…</code>, <code>FOO_TOKEN=…</code>,{" "}
              <code>FOO_SECRET=…</code>, <code>FOO_PASSWORD=…</code>
            </li>
          </ul>
          <p>
            Redaction is best-effort. We catch the common shapes of credentials
            but cannot guarantee that every secret a model or a shell command
            ever emits will match a pattern. Treat a trace like the rest of
            your pull request: review it before sharing.
          </p>

          <h2>How we use it</h2>
          <ul>
            <li>To authenticate you and keep you signed in.</li>
            <li>To render uploaded traces in the viewer.</li>
            <li>
              To gate private-repo traces — when someone opens a trace from
              a private repository, we use that viewer's GitHub OAuth token
              to check, against GitHub, whether they have read access to the
              repo. If they don't, we don't serve the trace.
            </li>
          </ul>
          <p>
            We don't sell your data. We don't run advertising trackers. We
            don't use your traces to train models.
          </p>

          <h2>Visibility &amp; sharing</h2>
          <p>
            A trace inherits the visibility of its repository at the moment
            it was uploaded. Traces from public repositories are viewable by
            anyone with the link. Traces from private repositories require a
            signed-in viewer with GitHub read access to that repo. Standalone
            traces uploaded without a pull request are accessible to anyone
            with the link.
          </p>

          <h2>Third parties</h2>
          <p>We rely on the following services to operate vibeshub:</p>
          <ul>
            <li>
              <strong>GitHub</strong> — for OAuth sign-in and for repository
              access checks via the GitHub API.
            </li>
            <li>
              <strong>Microsoft Azure</strong> — vibeshub runs on Azure
              Container Apps, with Azure Database for PostgreSQL for metadata
              and Azure Blob Storage for trace blobs. Access is brokered via
              managed identity.
            </li>
          </ul>
          <p>
            These providers process data on our behalf to host the service.
            We do not share your data with anyone else.
          </p>

          <h2>Retention &amp; deletion</h2>
          <p>
            You can delete any trace you uploaded at any time. Inside Claude
            Code, run{" "}
            <code>/share-trace delete &lt;pr-url | /t/&lt;id&gt; url | short-id&gt;</code>; only
            the original uploader can delete a trace. Sessions expire on
            their own, and signing out invalidates the current session
            immediately.
          </p>
          <p>
            We keep traces and account data for as long as your account is
            active. If you want everything tied to your account removed,
            contact us at the address below.
          </p>

          <h2>Your rights &amp; contact</h2>
          <p>
            For privacy questions, access requests, or to ask us to delete
            data associated with your account, email{" "}
            <a href="mailto:bhavya@vibeshub.ai">bhavya@vibeshub.ai</a>.
          </p>

          <h2>Changes to this policy</h2>
          <p>
            If we change what we collect or how we use it, we'll update this
            page and bump the effective date at the top.
          </p>
        </article>
      </main>

      <footer className="footer">
        <span>privacy policy</span>
        <span>
          <Link to="/contact">Contact</Link> · vibeshub
        </span>
      </footer>
    </div>
  );
}
