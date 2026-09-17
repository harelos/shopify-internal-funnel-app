import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";

export const VISITOR_COOKIE = "_fv";
export const VISITOR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function readCookie(req: Request, name: string): string {
  const raw = req.headers.cookie;
  if (!raw) return "";
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return "";
}

/**
 * The visitor token has to survive page loads and step navigation. Minting a
 * random one per request re-bucketed the split test on every view and recorded
 * events under a different identity than the one that was tested, so prefer the
 * cookie the browser already carries and only mint a token for a new visitor.
 */
export function resolveVisitorId(req: Request, res: Response): string {
  const carried = readCookie(req, VISITOR_COOKIE)
    || String(req.headers["x-visitor-id"] ?? "")
    || String(req.query.vid ?? "");
  const visitorId = carried || `v_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  res.setHeader(
    "Set-Cookie",
    `${VISITOR_COOKIE}=${encodeURIComponent(visitorId)}; Path=/; Max-Age=${VISITOR_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`,
  );
  return visitorId;
}
