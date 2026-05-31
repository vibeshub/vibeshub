import { PageTopbar } from "../components/PageTopbar";
import { SeoHead } from "../components/SeoHead";
import styles from "./Contact.module.css";

export function Contact() {
  return (
    <div className="page-shell">
      <SeoHead
        title="Contact"
        description="Get in touch with the vibeshub team. Email us about support, feedback, or anything to do with hosting and viewing your Claude Code traces."
        path="/contact"
      />
      <PageTopbar crumbs={[{ label: "Contact", current: true }]} />

      <main className={styles.contact}>
        <div className={styles.eyebrow}>
          <span className={styles.dot} />
          <span>CONTACT</span>
        </div>
        <h1 className={styles.title}>Get in touch</h1>
        <p className={styles.lead}>
          Questions, feedback, or something not working right? Send us a note
          and we'll get back to you.
        </p>
        <a className={styles.email} href="mailto:bhavya@vibeshub.ai">
          bhavya@vibeshub.ai
          <span className={styles.emailArrow} aria-hidden="true">
            &rarr;
          </span>
        </a>
      </main>

      <footer className="footer">
        <span>contact</span>
        <span>vibeshub</span>
      </footer>
    </div>
  );
}
