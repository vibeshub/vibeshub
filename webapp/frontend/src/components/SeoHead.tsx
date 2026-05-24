// SeoHead renders the document <head> tags for a route. React 19 hoists
// <title>, <meta>, and <link> rendered from components into the document
// head automatically, so no helmet library is needed.
//
// Pass an absolute `path` (e.g. "/privacy") to emit a canonical link.
// The brand suffix " · vibeshub" is appended to titles automatically;
// pass `bareTitle` to opt out (use it for the landing page where the
// brand is already in the title).

const SITE_URL = "https://vibeshub.ai";
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-default.png`;

export interface SeoHeadProps {
  title: string;
  description: string;
  path?: string;
  image?: string;
  ogType?: "website" | "article" | "profile";
  bareTitle?: boolean;
  noindex?: boolean;
}

export function SeoHead({
  title,
  description,
  path,
  image = DEFAULT_OG_IMAGE,
  ogType = "website",
  bareTitle = false,
  noindex = false,
}: SeoHeadProps) {
  const fullTitle = bareTitle ? title : `${title} · vibeshub`;
  const canonical = path ? `${SITE_URL}${path}` : undefined;

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
