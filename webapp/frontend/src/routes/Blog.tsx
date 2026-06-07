import { Link } from "react-router-dom";
import { PageTopbar } from "../components/PageTopbar";
import { SeoHead } from "../components/SeoHead";
import { postsByDate } from "../blog/posts";
import styles from "./Blog.module.css";

export function Blog() {
  const posts = postsByDate();
  return (
    <div className="page-shell">
      <SeoHead
        title="Blog"
        description="Notes on shipping, reviewing, and learning from AI coding sessions as a team, from the people building vibeshub."
        path="/blog"
      />
      <PageTopbar crumbs={[{ label: "Blog", current: true }]} />

      <main className={styles.index}>
        <header className={styles.indexHead}>
          <div className={styles.eyebrow}>
            <span className={styles.dot} />
            <span>BLOG</span>
          </div>
          <h1 className={styles.indexTitle}>The vibeshub blog</h1>
          <p className={styles.indexLede}>
            Notes on shipping, reviewing, and learning from AI coding sessions
            as a team.
          </p>
        </header>

        <div className={styles.postList}>
          {posts.map((post) => (
            <Link
              key={post.slug}
              to={`/blog/${post.slug}`}
              className={styles.card}
            >
              <img className={styles.cardThumb} src={post.image} alt="" />
              <div>
                <div className={styles.cardMeta}>
                  <time dateTime={post.date}>{post.dateLabel}</time>
                  <span className={styles.sep}>·</span>
                  <span>{post.readingTime}</span>
                </div>
                <h2 className={styles.cardTitle}>{post.title}</h2>
                <p className={styles.cardExcerpt}>{post.excerpt}</p>
                <span className={styles.cardMore}>Read →</span>
              </div>
            </Link>
          ))}
        </div>
      </main>

      <footer className="footer">
        <span>vibeshub blog</span>
        <span>
          <Link to="/">Home</Link> · vibeshub
        </span>
      </footer>
    </div>
  );
}
