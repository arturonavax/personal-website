import type {
  EdgeRoutingPolicyPort,
  RequestClassification,
  CanonicalRedirectResult,
} from "../../ports/edge-delivery.port";

export const THEMATIC_SUBDOMAINS: Record<string, string> = {
  "blog.arturonavax.dev": "/blog",
  "projects.arturonavax.dev": "/projects",
  "services.arturonavax.dev": "/services",
  "experience.arturonavax.dev": "/experience",
  "resume.arturonavax.dev": "/resume",
  "maker.arturonavax.dev": "/resume/maker",
};

export const ADMIN_HOSTNAMES = new Set([
  "admin.arturonavax.dev",
  "dash.arturonavax.dev",
]);

const STATIC_EXT_REGEX =
  /\.(?:css|js|mjs|map|json|png|jpg|jpeg|webp|avif|svg|ico|gif|woff|woff2|ttf|eot|xml|txt|pdf|webmanifest)$/i;

/**
 * Resolves the canonical target path on apex domain for a thematic subdomain.
 */
export function resolveSubdomainPath(
  host: string,
  pathname: string,
): string | null {
  const base = THEMATIC_SUBDOMAINS[host.toLowerCase()];
  if (!base) return null;

  const cleanPath = pathname.replace(/^\/+/, "");
  if (!cleanPath) {
    return `${base}/`;
  }

  const baseWithoutSlash = base.replace(/^\/+/, "");
  if (
    cleanPath === baseWithoutSlash ||
    cleanPath.startsWith(`${baseWithoutSlash}/`)
  ) {
    return `/${cleanPath}`;
  }

  return `${base}/${cleanPath}`;
}

export class CloudflareEdgeRoutingPolicy implements EdgeRoutingPolicyPort {
  classify(url: URL, request: Request): RequestClassification {
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname;

    // 1. Admin surface isolation
    if (ADMIN_HOSTNAMES.has(host)) {
      return "ADMIN_SURFACE";
    }

    // 2. Subdomain aliases
    if (host in THEMATIC_SUBDOMAINS) {
      return "SUBDOMAIN_ALIAS";
    }

    // 3. Admin path on apex
    if (pathname === "/admin" || pathname.startsWith("/admin/")) {
      return "ADMIN_SURFACE";
    }

    // 4. Telemetry ingestion
    if (pathname === "/api/v1/telemetry") {
      return "TELEMETRY_INGESTION";
    }

    // 5. Dynamic API endpoints
    if (pathname === "/api/search" || pathname === "/api/verify-captcha") {
      return "DYNAMIC_API";
    }

    // 6. Static immutable assets & fingerprinted bundles
    if (
      pathname.startsWith("/_astro/") ||
      pathname.startsWith("/fonts/") ||
      STATIC_EXT_REGEX.test(pathname)
    ) {
      return "STATIC_ASSET";
    }

    // 7. Public HTML documents
    if (request.method === "GET") {
      const accept = request.headers.get("accept") || "";
      const secFetchDest = request.headers.get("sec-fetch-dest");
      const isDocumentNavigation = !secFetchDest || secFetchDest === "document";

      if (
        accept.includes("text/html") ||
        isDocumentNavigation ||
        !pathname.includes(".")
      ) {
        return "PUBLIC_DOCUMENT";
      }
    }

    return "PASSTHROUGH";
  }

  resolveCanonicalRedirect(url: URL): CanonicalRedirectResult {
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname;

    // Admin redirect from apex to dedicated isolated subdomain
    if (pathname === "/admin" || pathname.startsWith("/admin/")) {
      const adminPath = pathname.replace(/^\/admin/, "") || "/";
      return {
        shouldRedirect: true,
        targetUrl: `https://admin.arturonavax.dev${adminPath}${url.search}`,
        statusCode: 308,
      };
    }

    // Thematic subdomain redirect to apex canonical path
    if (host in THEMATIC_SUBDOMAINS) {
      const targetPath = resolveSubdomainPath(host, pathname);
      if (targetPath) {
        return {
          shouldRedirect: true,
          targetUrl: `https://arturonavax.dev${targetPath}${url.search}`,
          statusCode: 308,
        };
      }
    }

    return {
      shouldRedirect: false,
      statusCode: 308,
    };
  }

  isFastPathCandidate(classification: RequestClassification): boolean {
    return (
      classification === "STATIC_ASSET" || classification === "PUBLIC_DOCUMENT"
    );
  }
}
