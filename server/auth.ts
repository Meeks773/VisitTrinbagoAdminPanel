import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

const ADMIN_EMAIL = "ttl@visittrinbago.com";
const ADMIN_PASSWORD = "ttl2025-2026";

declare module "express-session" {
  interface SessionData {
    user?: { email: string };
  }
}

export function setupAuth(app: Express) {
  const PgStore = connectPgSimple(session);
  const store = new PgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
    tableName: "user_sessions",
  });

  const secret = process.env.SESSION_SECRET || "visittrinbago-dev-secret";
  const isProd = process.env.NODE_ENV === "production";

  app.set("trust proxy", 1);
  app.use(
    session({
      store,
      secret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 24 * 30,
      },
    }),
  );

  app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ message: "Email and password required" });
    }
    if (email.trim().toLowerCase() !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    req.session.user = { email: ADMIN_EMAIL };
    req.session.save((err) => {
      if (err) return res.status(500).json({ message: "Session error" });
      res.json({ user: { email: ADMIN_EMAIL } });
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ ok: true });
    });
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    res.json({ user: req.session.user });
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session?.user) return next();
  res.status(401).json({ message: "Not authenticated" });
}
