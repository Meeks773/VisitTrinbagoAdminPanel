import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import session from "express-session";
import { isAuthenticatedAdmin, requireAuth, setupAuth } from "../server/auth";

// All credentials and session stores in this file are synthetic and isolated.
const TEST_EMAIL = "security-test-admin@example.invalid";
const TEST_PASSWORD = "synthetic-test-password-123456";
const TEST_SECRET = "synthetic-session-secret-at-least-32-characters";

function setTestEnvironment() {
  process.env.ADMIN_EMAIL = TEST_EMAIL;
  process.env.ADMIN_PASSWORD = TEST_PASSWORD;
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.NODE_ENV = "test";
}

async function withEnvironment(run: () => void | Promise<void>) {
  // This isolated test process never reads or backs up inherited credentials.
  setTestEnvironment();
  try {
    await run();
  } finally {
    setTestEnvironment();
  }
}

function cookieFrom(response: globalThis.Response): string {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie, "Fixture expected a session cookie");
  return cookie.split(";")[0];
}

function idFrom(cookie: string): string {
  return decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1)).slice(2).split(".")[0];
}

function getSession(store: session.Store, cookie: string): Promise<session.SessionData | null | undefined> {
  return new Promise((resolve, reject) => {
    store.get(idFrom(cookie), (err, value) => err ? reject(err) : resolve(value));
  });
}

function setSession(store: session.Store, cookie: string, data: session.SessionData): Promise<void> {
  return new Promise((resolve, reject) => {
    store.set(idFrom(cookie), data, (err) => err ? reject(err) : resolve());
  });
}

type Fixture = {
  base: string;
  store: session.MemoryStore;
  request: (path: string, options?: RequestInit) => Promise<globalThis.Response>;
  login: (body?: unknown, headers?: Record<string, string>) => Promise<globalThis.Response>;
};

async function withFixture(
  run: (fixture: Fixture) => Promise<void>,
  store = new session.MemoryStore(),
  nodeEnv = "test",
) {
  await withEnvironment(async () => {
    process.env.NODE_ENV = nodeEnv;
    const app = express();
    // Let malformed JSON value types reach auth's own input validation.
    app.use(express.json({ strict: false }));
    setupAuth(app, { store });
    app.get("/api/public/read", (_req, res) => res.json({ available: true }));
    app.post("/api/public/write", (_req, res) => res.json({ ok: true }));
    app.get("/api/private", requireAuth, (req, res) => res.json({ user: req.session.user }));
    app.post("/api/private", requireAuth, (_req, res) => res.json({ ok: true }));
    app.get("/api/optional", (req, res) => res.json({ authenticated: isAuthenticatedAdmin(req) }));
    app.post("/fixture/legacy-session", (req, res) => {
      req.session.user = { email: TEST_EMAIL };
      res.json({ ok: true });
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const request: Fixture["request"] = (path, options) => fetch(`${base}${path}`, options);
    const login: Fixture["login"] = (body = { email: TEST_EMAIL, password: TEST_PASSWORD }, headers = {}) =>
      request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    try {
      await run({ base, store, request, login });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => err ? reject(err) : resolve());
        server.closeAllConnections();
      });
      store.clear();
    }
  });
}

test("startup rejects missing, short or padding-only session secrets without disclosing them", async () => {
  await withEnvironment(() => {
    for (const value of [undefined, "", "too-short", " ".repeat(32)]) {
      if (value === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = value;
      assert.throws(
        () => setupAuth(express(), { store: new session.MemoryStore() }),
        { message: "SESSION_SECRET must be configured with at least 32 non-padding characters" },
      );
    }
    process.env.SESSION_SECRET = "s".repeat(32);
    assert.doesNotThrow(() => setupAuth(express(), { store: new session.MemoryStore() }));
  });
});

test("missing or invalid admin configuration returns 503 while public reads stay available", async () => {
  await withFixture(async ({ login, request }) => {
    const cases = [
      { email: undefined, password: TEST_PASSWORD },
      { email: TEST_EMAIL, password: undefined },
      { email: "", password: TEST_PASSWORD },
      { email: "invalid-email", password: TEST_PASSWORD },
      { email: TEST_EMAIL, password: "x".repeat(15) },
      { email: TEST_EMAIL, password: " ".repeat(16) },
      { email: TEST_EMAIL, password: "x".repeat(4097) },
    ];
    for (const config of cases) {
      if (config.email === undefined) delete process.env.ADMIN_EMAIL;
      else process.env.ADMIN_EMAIL = config.email;
      if (config.password === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = config.password;
      const response = await login();
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.deepEqual(await response.json(), {
        message: "Admin login is unavailable: valid admin credentials must be configured",
      });
      assert.equal((await request("/api/public/read")).status, 200);
      assert.equal((await request("/api/private")).status, 401);
    }
    process.env.ADMIN_EMAIL = TEST_EMAIL;
    process.env.ADMIN_PASSWORD = "x".repeat(16);
    assert.equal((await login({ email: TEST_EMAIL, password: "x".repeat(16) })).status, 200);
  });
});

test("login preserves normalized user interface, secure cookie attributes and exact password matching", async () => {
  await withFixture(async ({ login, request, store }) => {
    process.env.ADMIN_EMAIL = ` ${TEST_EMAIL.toUpperCase()} `;
    assert.equal((await login({ email: TEST_EMAIL, password: `${TEST_PASSWORD} ` })).status, 401);
    const response = await login({ email: ` ${TEST_EMAIL.toUpperCase()} `, password: TEST_PASSWORD });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { user: { email: TEST_EMAIL } });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("set-cookie")!, /HttpOnly/);
    assert.match(response.headers.get("set-cookie")!, /SameSite=Lax/);
    const cookie = cookieFrom(response);
    const stored = await getSession(store, cookie);
    assert.match(stored!.adminCredentialVersion!, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(stored).includes(TEST_PASSWORD), false);
    assert.equal(JSON.stringify(stored).includes(TEST_SECRET), false);
    const me = await request("/api/auth/me", { headers: { Cookie: cookie } });
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), { user: { email: TEST_EMAIL } });
    assert.equal((await request("/api/private", { headers: { Cookie: cookie } })).status, 200);
    assert.deepEqual(await (await request("/api/optional", { headers: { Cookie: cookie } })).json(), { authenticated: true });
  });
});

test("legacy sessions are rejected and login regenerates the session ID", async () => {
  await withFixture(async ({ login, request, store }) => {
    const legacy = cookieFrom(await request("/fixture/legacy-session", { method: "POST" }));
    assert.deepEqual(await (await request("/api/optional", { headers: { Cookie: legacy } })).json(), { authenticated: false });
    assert.equal((await request("/api/auth/me", { headers: { Cookie: legacy } })).status, 401);
    assert.equal((await request("/api/private", { headers: { Cookie: legacy } })).status, 401);
    const response = await login(undefined, { Cookie: legacy });
    assert.equal(response.status, 200);
    const fresh = cookieFrom(response);
    assert.notEqual(idFrom(fresh), idFrom(legacy));
    assert.equal(await getSession(store, legacy), undefined);
    assert.equal((await request("/api/private", { headers: { Cookie: legacy } })).status, 401);
    assert.equal((await request("/api/private", { headers: { Cookie: fresh } })).status, 200);
  });
});

test("password, email and secret rotation invalidate previously issued sessions immediately", async () => {
  await withFixture(async ({ login, request }) => {
    for (const [key, replacement] of [
      ["ADMIN_PASSWORD", "rotated-synthetic-password-123456"],
      ["ADMIN_EMAIL", "rotated-test-admin@example.invalid"],
      ["SESSION_SECRET", "rotated-synthetic-session-secret-32-characters"],
    ] as const) {
      setTestEnvironment();
      const cookie = cookieFrom(await login());
      process.env[key] = replacement;
      assert.deepEqual(await (await request("/api/optional", { headers: { Cookie: cookie } })).json(), { authenticated: false });
      assert.equal((await request("/api/auth/me", { headers: { Cookie: cookie } })).status, 401);
      assert.equal((await request("/api/private", { headers: { Cookie: cookie } })).status, 401);
    }
    setTestEnvironment();
    const cookie = cookieFrom(await login());
    delete process.env.ADMIN_PASSWORD;
    assert.equal((await request("/api/private", { headers: { Cookie: cookie } })).status, 401);
    assert.equal((await request("/api/public/read")).status, 200);
  });
});

test("forged versions and mismatched stored identities never authenticate", async () => {
  await withFixture(async ({ login, request, store }) => {
    for (const tamper of [
      (data: session.SessionData) => { data.adminCredentialVersion = "0".repeat(64); },
      (data: session.SessionData) => { delete data.adminCredentialVersion; },
      (data: session.SessionData) => { data.user = { email: "another-test@example.invalid" }; },
    ]) {
      const cookie = cookieFrom(await login());
      const data = (await getSession(store, cookie))!;
      tamper(data);
      await setSession(store, cookie, data);
      assert.deepEqual(await (await request("/api/optional", { headers: { Cookie: cookie } })).json(), { authenticated: false });
      assert.equal((await request("/api/auth/me", { headers: { Cookie: cookie } })).status, 401);
    }
  });
});

test("malformed inputs have safe errors, and failed login does not issue a session", async () => {
  await withFixture(async ({ login }) => {
    for (const body of [
      {},
      null,
      { email: 123, password: TEST_PASSWORD },
      { email: TEST_EMAIL, password: ["not-a-string"] },
      { email: "e".repeat(255), password: TEST_PASSWORD },
    ]) {
      const response = await login(body);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { message: "Email and password required" });
      assert.equal(response.headers.get("set-cookie"), null);
    }
  });
});

test("wrong credentials use one generic response for email and password failures", async () => {
  await withFixture(async ({ login }) => {
    for (const body of [
      { email: TEST_EMAIL, password: "wrong-password" },
      { email: "unknown-test@example.invalid", password: TEST_PASSWORD },
    ]) {
      const response = await login(body);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { message: "Invalid credentials" });
      assert.equal(response.headers.get("set-cookie"), null);
    }
  });
});

test("login throttling rejects further attempts until expiry and separates clients", async (context) => {
  await withFixture(async ({ login }) => {
    let clock = Date.now();
    context.mock.method(Date, "now", () => clock);
    const invalid = { email: TEST_EMAIL, password: "wrong-password" };
    for (let i = 0; i < 5; i++) assert.equal((await login(invalid)).status, 401);
    const limited = await login();
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "900");
    assert.deepEqual(await limited.json(), { message: "Too many login attempts. Try again later" });
    assert.equal((await login(undefined, { "X-Forwarded-For": "192.0.2.100" })).status, 200);
    clock += 15 * 60 * 1000;
    assert.equal((await login()).status, 200);
  });
});

test("successful login resets its client's failed-attempt counter", async () => {
  await withFixture(async ({ login }) => {
    for (let i = 0; i < 4; i++) {
      assert.equal((await login({ email: TEST_EMAIL, password: "wrong" })).status, 401);
    }
    assert.equal((await login()).status, 200);
    for (let i = 0; i < 5; i++) {
      assert.equal((await login({ email: TEST_EMAIL, password: "wrong" })).status, 401);
    }
    assert.equal((await login()).status, 429);
  });
});

test("login throttle storage stays bounded and recovers after the window expires", async (context) => {
  await withFixture(async ({ login }) => {
    let clock = Date.now();
    context.mock.method(Date, "now", () => clock);
    const invalid = { email: TEST_EMAIL, password: "wrong" };
    for (let i = 0; i < 1000; i++) {
      const client = `198.18.${Math.floor(i / 250)}.${(i % 250) + 1}`;
      assert.equal((await login(invalid, { "X-Forwarded-For": client })).status, 401);
    }
    assert.equal((await login(undefined, { "X-Forwarded-For": "192.0.2.200" })).status, 429);
    clock += 15 * 60 * 1000;
    assert.equal((await login(undefined, { "X-Forwarded-For": "192.0.2.200" })).status, 200);
  });
});

test("cross-origin browser writes are blocked globally while public reads and cURL-style writes work", async () => {
  await withFixture(async ({ base, request, login }) => {
    const rejectedHeaders: Record<string, string>[] = [
      { Origin: "https://cross-origin.example.invalid" },
      { Origin: "null" },
      { Origin: `${base}/not-an-origin` },
      { Origin: base, "Sec-Fetch-Site": "cross-site" },
      { "Sec-Fetch-Site": "same-site" },
      { Referer: "https://cross-origin.example.invalid/page" },
    ];
    for (const headers of rejectedHeaders) {
      assert.equal((await login(undefined, headers)).status, 403);
      assert.equal((await request("/api/public/write", { method: "POST", headers })).status, 403);
      assert.equal((await request("/api/public/read", { headers })).status, 200);
    }
    assert.equal((await request("/api/public/write", { method: "POST" })).status, 200);
    assert.equal((await login(undefined, { Origin: base, "Sec-Fetch-Site": "same-origin" })).status, 200);
    assert.equal((await request("/api/public/write", { method: "POST", headers: { Referer: `${base}/page` } })).status, 200);
  });
});

test("HTTPS behind the configured proxy is recognized for same-origin writes", async () => {
  await withFixture(async ({ base, login }) => {
    const origin = base.replace("http:", "https:");
    assert.equal((await login(undefined, { Origin: origin, "X-Forwarded-Proto": "https" })).status, 200);
    assert.equal((await login(undefined, { Origin: origin })).status, 403);
  });
});

test("production sets and clears Secure, HttpOnly and SameSite session cookies", async () => {
  await withFixture(async ({ base, login, request }) => {
    const proxyHeaders = { Origin: base.replace("http:", "https:"), "X-Forwarded-Proto": "https" };
    const response = await login(undefined, proxyHeaders);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie")!, /; Secure/);
    assert.match(response.headers.get("set-cookie")!, /; HttpOnly/);
    assert.match(response.headers.get("set-cookie")!, /; SameSite=Lax/);
    const logout = await request("/api/auth/logout", {
      method: "POST", headers: { ...proxyHeaders, Cookie: cookieFrom(response) },
    });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie")!, /; Secure/);
    assert.match(logout.headers.get("set-cookie")!, /; HttpOnly/);
    assert.match(logout.headers.get("set-cookie")!, /; SameSite=Lax/);
  }, new session.MemoryStore(), "production");
});

test("CSRF rejection cannot mutate an authenticated session, and logout invalidates it", async () => {
  await withFixture(async ({ login, request, base }) => {
    const cookie = cookieFrom(await login());
    assert.equal((await request("/api/private", {
      method: "POST", headers: { Cookie: cookie, Origin: "https://cross-origin.example.invalid" },
    })).status, 403);
    assert.equal((await request("/api/auth/logout", {
      method: "POST", headers: { Cookie: cookie, "Sec-Fetch-Site": "cross-site" },
    })).status, 403);
    assert.equal((await request("/api/private", { headers: { Cookie: cookie } })).status, 200);
    const logout = await request("/api/auth/logout", {
      method: "POST", headers: { Cookie: cookie, Origin: base },
    });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie")!, /connect.sid=;/);
    assert.equal((await request("/api/auth/me", { headers: { Cookie: cookie } })).status, 401);
  });
});

test("session regeneration, save and destruction failures return generic errors without leaks", async () => {
  class FailingStore extends session.MemoryStore {
    failDestroy = false;
    failSave = false;
    override destroy(sid: string, callback?: (err?: unknown) => void) {
      if (this.failDestroy) return callback?.(new Error("synthetic-private-store-error"));
      super.destroy(sid, callback);
    }
    override set(sid: string, data: session.SessionData, callback?: (err?: unknown) => void) {
      if (this.failSave) return callback?.(new Error("synthetic-private-store-error"));
      super.set(sid, data, callback);
    }
  }
  const store = new FailingStore();
  await withFixture(async ({ login, request }) => {
    store.failDestroy = true;
    const regenerate = await login();
    assert.equal(regenerate.status, 500);
    assert.deepEqual(await regenerate.json(), { message: "Session error" });
    store.failDestroy = false;
    store.failSave = true;
    const save = await login();
    assert.equal(save.status, 500);
    assert.deepEqual(await save.json(), { message: "Session error" });
    store.failSave = false;
    const cookie = cookieFrom(await login());
    store.failDestroy = true;
    const logout = await request("/api/auth/logout", { method: "POST", headers: { Cookie: cookie } });
    assert.equal(logout.status, 500);
    assert.deepEqual(await logout.json(), { message: "Session error" });
  }, store);
});