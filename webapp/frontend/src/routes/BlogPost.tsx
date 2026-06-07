import { Link, useParams } from "react-router-dom";
import { PageTopbar } from "../components/PageTopbar";
import { SeoHead } from "../components/SeoHead";
import { getPost } from "../blog/posts";
import { NotFound } from "./NotFound";
import styles from "./Blog.module.css";

const SITE_URL = "https://vibeshub.ai";

export function BlogPost() {
  const { slug } = useParams();
  const post = slug ? getPost(slug) : undefined;

  if (!post) return <NotFound />;

  const { Body } = post;
  // Keep the breadcrumb tidy; the full title is the H1 right below it.
  const crumbLabel =
    post.title.length > 42 ? `${post.title.slice(0, 40).trimEnd()}…` : post.title;

  return (
    <div className="page-shell">
      <SeoHead
        title={post.title}
        description={post.description}
        path={`/blog/${post.slug}`}
        image={`${SITE_URL}${post.image}`}
        ogType="article"
      />
      <PageTopbar
        crumbs={[
          { label: "Blog", to: "/blog" },
          { label: crumbLabel, current: true },
        ]}
      />

      <main className={styles.post}>
        <header className={styles.postHead}>
          <div className={styles.eyebrow}>
            <span className={styles.dot} />
            <span>BLOG</span>
          </div>
          <h1 className={styles.postTitle}>{post.title}</h1>
          <div className={styles.byline}>
            <span className={styles.author}>{post.author}</span>
            <span className={styles.sep}>·</span>
            <time dateTime={post.date}>{post.dateLabel}</time>
            <span className={styles.sep}>·</span>
            <span>{post.readingTime}</span>
          </div>
        </header>

        <article className={styles.prose}>
          <Body />
        </article>

        <Link to="/blog" className={styles.backLink}>
          ← All posts
        </Link>
      </main>

      <footer className="footer">
        <span>vibeshub blog</span>
        <span>
          <Link to="/blog">All posts</Link> · vibeshub
        </span>
      </footer>
    </div>
  );
}
