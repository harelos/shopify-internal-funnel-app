import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

function clean(value: string | undefined): string {
  return value?.trim() ?? "";
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function adminBasicAuthConfigured(): boolean {
  return Boolean(clean(process.env.ADMIN_BASIC_AUTH_USER) && clean(process.env.ADMIN_BASIC_AUTH_PASSWORD));
}

/**
 * Interim owner-only gate for the hosted dashboard. It stays a no-op locally,
 * where the credentials are unset, so the local preview keeps working. Once a
 * Custom Distribution app is configured, SHOPIFY_REQUIRE_AUTH=true makes App
 * Bridge session tokens the real boundary and this gate becomes redundant.
 */
export function requireAdminBasicAuth(req: Request, res: Response, next: NextFunction) {
  if (!adminBasicAuthConfigured()) return next();

  const header = req.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator !== -1) {
      // Both comparisons run before the decision so a wrong user name and a
      // wrong password cost the same time.
      const userMatches = constantTimeEqual(decoded.slice(0, separator), clean(process.env.ADMIN_BASIC_AUTH_USER));
      const passwordMatches = constantTimeEqual(decoded.slice(separator + 1), clean(process.env.ADMIN_BASIC_AUTH_PASSWORD));
      if (userMatches && passwordMatches) return next();
    }
  }

  res.setHeader("WWW-Authenticate", 'Basic realm="Funnel Control", charset="UTF-8"');
  return res.status(401).json({ error: "Administrator credentials required." });
}
