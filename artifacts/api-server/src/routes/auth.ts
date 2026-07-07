import * as oidc from "openid-client";
import bcrypt from "bcryptjs";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  clearSession, getOidcConfig, getSessionId, createSession, getSession,
  SESSION_COOKIE, SESSION_TTL, type SessionData,
} from "../lib/auth";

const OIDC_COOKIE_TTL = 10 * 60 * 1000;
const router: IRouter = Router();

// ── helpers ──────────────────────────────────────────────────────────────────

function getFrontendUrl(): string {
  const configured = process.env.FRONTEND_URL?.replace(/\/$/, "");
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? "https://localhost" : "http://localhost:3000";
}

function getOrigin(req: Request): string {
  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    (process.env.NODE_ENV === "production" ? "https" : "http");
  const host =
    (req.headers["x-forwarded-host"] as string) || req.headers.host || "localhost:3000";
  return `${proto}://${host}`;
}

function cookieSecure(): boolean {
  return process.env.NODE_ENV === "production";
}

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, { httpOnly: true, secure: cookieSecure(), sameSite: "lax", path: "/", maxAge: SESSION_TTL });
}

function setOidcCookie(res: Response, name: string, value: string) {
  res.cookie(name, value, { httpOnly: true, secure: cookieSecure(), sameSite: "lax", path: "/", maxAge: OIDC_COOKIE_TTL });
}

function getSafeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

// ── who-am-i ─────────────────────────────────────────────────────────────────

router.get("/auth/user", (req: Request, res: Response) => {
  res.json({ user: req.isAuthenticated() ? req.user : null });
});

// ── email / password ──────────────────────────────────────────────────────────

router.post("/auth/register", async (req: Request, res: Response) => {
  const { email, password, firstName, lastName } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ ok: false, error: "Email and password are required." });
    return;
  }
  if (typeof password !== "string" || password.length < 8) {
    res.status(400).json({ ok: false, error: "Password must be at least 8 characters." });
    return;
  }
  const normalEmail = String(email).toLowerCase().trim();
  const existing = await db.select().from(usersTable).where(eq(usersTable.email, normalEmail)).limit(1);
  if (existing.length > 0) {
    res.status(409).json({ ok: false, error: "An account with that email already exists." });
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db.insert(usersTable).values({
    email: normalEmail,
    firstName: firstName ? String(firstName).trim() : null,
    lastName: lastName ? String(lastName).trim() : null,
    passwordHash,
    authProvider: "email",
  }).returning();
  const sessionData: SessionData = {
    user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, profileImageUrl: null },
    access_token: "",
    authProvider: "email",
  };
  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.json({ ok: true, user: sessionData.user });
});

router.post("/auth/login", async (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ ok: false, error: "Email and password are required." });
    return;
  }
  const normalEmail = String(email).toLowerCase().trim();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalEmail)).limit(1);
  if (!user || !user.passwordHash) {
    res.status(401).json({ ok: false, error: "Invalid email or password." });
    return;
  }
  const valid = await bcrypt.compare(String(password), user.passwordHash);
  if (!valid) {
    res.status(401).json({ ok: false, error: "Invalid email or password." });
    return;
  }
  const sessionData: SessionData = {
    user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, profileImageUrl: user.profileImageUrl },
    access_token: "",
    authProvider: "email",
  };
  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.json({ ok: true, user: sessionData.user });
});

// ── Replit OIDC login ─────────────────────────────────────────────────────────

router.get("/login", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;
  const returnTo = getSafeReturnTo(req.query.returnTo);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const redirectTo = oidc.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl,
    scope: "openid email profile offline_access",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "login consent",
    state, nonce,
  });
  setOidcCookie(res, "code_verifier", codeVerifier);
  setOidcCookie(res, "nonce", nonce);
  setOidcCookie(res, "state", state);
  setOidcCookie(res, "return_to", returnTo);
  res.redirect(redirectTo.href);
});

router.get("/callback", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;
  const codeVerifier = req.cookies?.code_verifier;
  const nonce = req.cookies?.nonce;
  const expectedState = req.cookies?.state;
  if (!codeVerifier || !expectedState) { res.redirect("/api/login"); return; }
  const currentUrl = new URL(`${callbackUrl}?${new URL(req.url, `http://${req.headers.host}`).searchParams}`);
  let tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers;
  try {
    tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier, expectedNonce: nonce, expectedState, idTokenExpected: true,
    });
  } catch { res.redirect("/api/login"); return; }
  const returnTo = getSafeReturnTo(req.cookies?.return_to);
  res.clearCookie("code_verifier", { path: "/" });
  res.clearCookie("nonce", { path: "/" });
  res.clearCookie("state", { path: "/" });
  res.clearCookie("return_to", { path: "/" });
  const claims = tokens.claims();
  if (!claims) { res.redirect("/api/login"); return; }
  const oidcUser = {
    id: claims.sub as string,
    email: (claims.email as string) || null,
    firstName: (claims.first_name as string) || null,
    lastName: (claims.last_name as string) || null,
    profileImageUrl: ((claims.profile_image_url || claims.picture) as string) || null,
  };
  const [dbUser] = await db.insert(usersTable).values({ ...oidcUser, authProvider: "replit" })
    .onConflictDoUpdate({ target: usersTable.id, set: { ...oidcUser, updatedAt: new Date() } })
    .returning();
  const now = Math.floor(Date.now() / 1000);
  const sessionData: SessionData = {
    user: { id: dbUser.id, email: dbUser.email, firstName: dbUser.firstName, lastName: dbUser.lastName, profileImageUrl: dbUser.profileImageUrl },
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp,
    authProvider: "replit",
  };
  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.redirect(returnTo);
});

// ── logout ────────────────────────────────────────────────────────────────────

router.get("/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  const session = sid ? await getSession(sid) : null;
  await clearSession(res, sid);
  const returnTo = getSafeReturnTo(req.query.returnTo);
  const frontend = getFrontendUrl();
  const destination = `${frontend}${returnTo}`;
  if (session?.authProvider === "replit" && session.access_token) {
    try {
      const config = await getOidcConfig();
      const endSessionUrl = oidc.buildEndSessionUrl(config, {
        client_id: process.env.REPL_ID!,
        post_logout_redirect_uri: frontend,
      });
      res.redirect(endSessionUrl.href);
      return;
    } catch {}
  }
  res.redirect(destination);
});

export default router;
