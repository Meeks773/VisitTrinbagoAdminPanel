import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

declare module "express-session" {
  interface SessionData {
    user?: { email: string };
    adminCredentialVersion?: string;
  }
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const MAX_LOGIN_CLIENTS = 1000;
const MAX_PASSWORD_LENGTH = 4096;

function sessionSecret(): string | null {
  const secret = process.env.SESSION_SECRET;
  return secret && secret.trim().length >= 32 ? secret : null;
}

function adminCredentials() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const secret = sessionSecret();
  if (
    !email ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !password ||
    password.trim().length < 16 ||
    password.length > MAX_PASSWORD_LENGTH ||
    !secret
  ) {
    return null;
  }
  // Credential/secret rotation invalidates existing sessions. Legacy sessions
  // have no version and cannot pass this check.
  const version = createHmac("sha256", secret)
    .update(JSON.stringify(["single-admin-v1", email, password]))
    .digest("hex");
  return { email, password, version };
}

function safeEqual(left: string, right: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(left).digest(),
    createHash("sha256").update(right).digest(),
  );
}

export function isAuthenticatedAdmin(req: Request): boolean {
  const credentials = adminCredentials();
  const user = req.session?.user;
  const version = req.session?.adminCredentialVersion;
  if (!credentials || typeof user?.email !== "string" || typeof version !== "string") {
    return false;
  }
  const emailMatches = safeEqual(user.email, credentials.email);
  const versionMatches = safeEqual(version, credentials.version);
  return emailMatches && versionMatches;
}

// Browser writes must be same-origin; headerless non-browser clients are allowed.
export function requireSameOriginWrites(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const deny = () => res.status(403).json({ message: "Cross-origin requests are not allowed" });
  const site = req.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return deny();

  const origin = req.get("origin");
  const referer = req.get("referer");
  if (origin || referer) {
    try {
      const expected = new URL(`${req.protocol}://${req.get("host")}`).origin;
      const supplied = new URL(origin || referer!);
      if (
        !["http:", "https:"].includes(supplied.protocol) ||
        supplied.username ||
        supplied.password ||
        supplied.origin !== expected ||
        (origin && (supplied.pathname !== "/" || supplied.search || supplied.hash))
      ) {
        return deny();
      }
    } catch {
      return deny();
    }
  }
  return next();
}

// The optional store injection is for isolated tests; production keeps PgStore.
export function setupAuth(app: Express, options: { store?: session.Store } = {}) {
  const secret = sessionSecret();
  if (!secret) {
    throw new Error("SESSION_SECRET must be configured with at least 32 non-padding characters");
  }
  const store = options.store ?? new (connectPgSimple(session))({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
    tableName: "user_sessions",
  });
  const isProd = process.env.NODE_ENV === "production";
  const cookieOptions = { httpOnly: true, secure: isProd, sameSite: "lax" as const, path: "/" };
  const attempts = new Map<string, { count: number; expiresAt: number }>();

  app.set("trust proxy", 1);
  app.use(
    session({
      store,
      secret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        ...cookieOptions,
        maxAge: 1000 * 60 * 60 * 24 * 30,
      },
    }),
  );
  // setupAuth runs before application routes, so this also protects upload and
  // other API writes. Public reads and headerless cURL clients are unaffected.
  app.use("/api", requireSameOriginWrites);

  app.post("/api/auth/login", (req, res) => {
    res.set("Cache-Control", "no-store");
    const credentials = adminCredentials();
    if (!credentials) {
      return res.status(503).json({ message: "Admin login is unavailable: valid admin credentials must be configured" });
    }

    const now = Date.now();
    attempts.forEach((value, key) => {
      if (value.expiresAt <= now) attempts.delete(key);
    });
    const key = req.ip || req.socket.remoteAddress || "unknown";
    let attempt = attempts.get(key);
    if (!attempt && attempts.size < MAX_LOGIN_CLIENTS) {
      attempt = { count: 0, expiresAt: now + LOGIN_WINDOW_MS };
      attempts.set(key, attempt);
    }
    if (!attempt || attempt.count >= MAX_LOGIN_ATTEMPTS) {
      const remaining = (attempt?.expiresAt ?? now + LOGIN_WINDOW_MS) - now;
      res.set("Retry-After", String(Math.max(1, Math.ceil(remaining / 1000))));
      return res.status(429).json({ message: "Too many login attempts. Try again later" });
    }
    attempt.count++;

    const { email, password } = req.body ?? {};
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      email.length > 254 ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      return res.status(400).json({ message: "Email and password required" });
    }
    const emailMatches = safeEqual(email.trim().toLowerCase(), credentials.email);
    const passwordMatches = safeEqual(password, credentials.password);
    if (!emailMatches || !passwordMatches) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ message: "Session error" });
      // Configuration can change while awaiting session-store I/O.
      const current = adminCredentials();
      if (!current || !safeEqual(current.version, credentials.version)) {
        return res.status(503).json({ message: "Admin login is unavailable. Try again later" });
      }
      req.session.user = { email: credentials.email };
      req.session.adminCredentialVersion = credentials.version;
      req.session.save((saveError) => {
        if (saveError) {
          delete req.session.user;
          delete req.session.adminCredentialVersion;
          return res.status(500).json({ message: "Session error" });
        }
        attempts.delete(key);
        res.json({ user: { email: credentials.email } });
      });
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    res.set("Cache-Control", "no-store");
    req.session.destroy((err) => {
      res.clearCookie("connect.sid", cookieOptions);
      if (err) return res.status(500).json({ message: "Session error" });
      res.json({ ok: true });
    });
  });

  app.get("/api/auth/me", requireAuth, (req, res) => {
    res.json({ user: req.session.user });
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  res.set("Cache-Control", "no-store");
  if (isAuthenticatedAdmin(req)) return requireSameOriginWrites(req, res, next);
  if (req.session) {
    delete req.session.user;
    delete req.session.adminCredentialVersion;
  }
  res.status(401).json({ message: "Not authenticated" });
}