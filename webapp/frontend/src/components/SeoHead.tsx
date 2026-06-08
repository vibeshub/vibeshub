// SeoHead renders the document <head> tags for a route. React 19 hoists
// <title>, <meta>, and <link> rendered from components into the document
// head automatically, so no helmet library is needed.
//
// Pass an absolute `path` (e.g. "/privacy") to emit a canonical link.
// The brand suffix " · vibeshub" is appended to titles automatically;
// pass `bareTitle` to opt out (use it for the landing page where the
// brand is already in the title).

import { useEffect, useState } from "react";

const SITE_URL = "https://vibeshub.ai";
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-default.png`;

// A schema.org JSON-LD node (or list of nodes). Kept loose on purpose —
// callers build the object literally and we just serialize it.
export type JsonLd = Record<string, unknown> | Record<string, unknown>[];

export interface SeoHeadProps {
  title: string;
  description: string;
  path?: string;
  image?: string;
  ogType?: "website" | "article" | "profile";
  bareTitle?: boolean;
  noindex?: boolean;
  jsonLd?: JsonLd;
}

export function SeoHead({
  title,
  description,
  path,
  image = DEFAULT_OG_IMAGE,
  ogType = "website",
  bareTitle = false,
  noindex = false,
  jsonLd,
}: SeoHeadProps) {
  const fullTitle = bareTitle ? title : `${title} · vibeshub`;
  const canonical = path ? `${SITE_URL}${path}` : undefined;

  // Snapshot the stale SSR-injected nodes between the marker comments
  // BEFORE React 19 commits this render's hoisted <title>/<meta>/<link>
  // tags. Lazy useState initializer runs during render, which is before
  // the commit phase that hoists tags — so the captured node list contains
  // only the original SSR tags, not React's. Removing them later in
  // useEffect therefore doesn't touch any node React's fiber tracks.
  const [staleNodes] = useState<ChildNode[]>(() => {
    if (typeof document === "undefined") return [];
    const head = document.head;
    const walker = document.createNodeIterator(head, NodeFilter.SHOW_COMMENT);
    let start: Comment | null = null;
    let end: Comment | null = null;
    let node = walker.nextNode() as Comment | null;
    while (node) {
      if (node.data === "SEO_HEAD_START") start = node;
      else if (node.data === "SEO_HEAD_END") {
        end = node;
        break;
      }
      node = walker.nextNode() as Comment | null;
    }
    if (!start || !end) return [];
    const captured: ChildNode[] = [];
    for (let n = start.nextSibling; n && n !== end; n = n.nextSibling) {
      captured.push(n);
    }
    return captured;
  });

  useEffect(() => {
    for (const n of staleNodes) {
      if (n.parentNode) n.remove();
    }
  }, [staleNodes]);

  // React 19 hoists <title>/<meta>/<link> but NOT inline <script>, so JSON-LD
  // is injected into <head> imperatively. Depend on the serialized string so
  // the effect only re-runs when the structured data actually changes, not on
  // every render (callers pass a fresh object literal each time).
  const jsonLdStr = jsonLd ? JSON.stringify(jsonLd) : null;
  useEffect(() => {
    if (typeof document === "undefined" || !jsonLdStr) return;
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = jsonLdStr;
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, [jsonLdStr]);

  return (
    <>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      {canonical && <link rel="canonical" href={canonical} />}
      {noindex && <meta name="robots" content="noindex,nofollow" />}

      {/* Open Graph */}
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={ogType} />
      {canonical && <meta property="og:url" content={canonical} />}
      <meta property="og:image" content={image} />
      <meta property="og:site_name" content="vibeshub" />

      {/* Twitter card */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
    </>
  );
}
