"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { createClient } = require("redis");
const { randomUUID } = require("crypto");

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const REDIS_URL = process.env.REDIS_URL || "";
const IDS_KEY = "cite-raffle:ids";
const entryKey = (id) => `cite-raffle:entry:${id}`;

const indexHtml = fs.readFileSync(path.join(__dirname, "public", "index.html"));

let redis;
let redisReady = Promise.resolve();

if (REDIS_URL) {
  redis = createClient({ url: REDIS_URL });
  redis.on("error", (err) => {
    console.error("Redis error:", err);
  });
  redisReady = redis.connect();
}

function send(res, status, body, headers) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, {
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), {
    "Content-Type": "application/json; charset=utf-8",
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 20000) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseBody(req, raw) {
  const type = String(req.headers["content-type"] || "");
  if (type.includes("application/json")) {
    return raw ? JSON.parse(raw) : {};
  }
  if (type.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  return raw ? JSON.parse(raw) : {};
}

function clean(value, max) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isAdmin(url) {
  if (!ADMIN_KEY) return false;
  return url.searchParams.get("key") === ADMIN_KEY;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatPt(iso) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso)) + " PT";
  } catch {
    return iso;
  }
}

function toCsv(rows) {
  const headers = [
    "submitted_at_pt",
    "name",
    "school",
    "role",
    "email",
    "phone",
    "demo",
    "sms_opt_in",
    "status",
    "id",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    const values = [
      formatPt(row.createdAt),
      row.name,
      row.school,
      row.role,
      row.email,
      row.phone,
      row.demo ? "yes" : "no",
      row.smsOptIn ? "yes" : "no",
      row.deleted ? "deleted-test" : "active",
      row.id,
    ].map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`);
    lines.push(values.join(","));
  }
  return lines.join("\n");
}

async function allEntries() {
  if (!redis) return [];
  const ids = await redis.lRange(IDS_KEY, 0, -1);
  if (!ids.length) return [];
  const raw = await redis.mGet(ids.map(entryKey));
  return raw
    .map((item) => {
      try {
        return item ? JSON.parse(item) : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function entriesPage(entries) {
  const rows = entries
    .map((entry) => {
      const status = entry.deleted ? "Deleted test" : "Active";
      return `<tr class="${entry.deleted ? "deleted" : ""}">
        <td>${escapeHtml(formatPt(entry.createdAt))}</td>
        <td>${escapeHtml(entry.name)}</td>
        <td>${escapeHtml(entry.school)}</td>
        <td>${escapeHtml(entry.role)}</td>
        <td>${escapeHtml(entry.email)}</td>
        <td>${escapeHtml(entry.phone || "")}</td>
        <td>${entry.demo ? "Yes" : "No"}</td>
        <td>${entry.smsOptIn ? "Yes" : "No"}</td>
        <td>${status}</td>
        <td>${escapeHtml(entry.id)}</td>
      </tr>`;
    })
    .join("");
  const activeCount = entries.filter((entry) => !entry.deleted).length;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CITE raffle entries</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 24px; color: #122033; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    p { margin: 0 0 16px; color: #445; }
    table { border-collapse: collapse; width: 100%; font-size: 14px; }
    th, td { border-bottom: 1px solid #e5e7eb; text-align: left; padding: 8px 10px; vertical-align: top; }
    th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; color: #667; }
    tr.deleted td { color: #889; text-decoration: line-through; }
    a { color: #0b3a6e; }
  </style>
</head>
<body>
  <h1>LockedIn CITE raffle entries</h1>
  <p>${activeCount} active entr${activeCount === 1 ? "y" : "ies"}. <a href="?key=${encodeURIComponent(ADMIN_KEY)}&amp;download=csv">Download CSV</a></p>
  <table>
    <thead>
      <tr>
        <th>Submitted (PT)</th>
        <th>Name</th>
        <th>School</th>
        <th>Role</th>
        <th>Email</th>
        <th>Phone</th>
        <th>Demo</th>
        <th>SMS opt-in</th>
        <th>Status</th>
        <th>ID</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="10">No entries yet.</td></tr>'}
    </tbody>
  </table>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    await redisReady;
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      send(res, 200, indexHtml, { "Content-Type": "text/html; charset=utf-8" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, redis: Boolean(redis?.isReady) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/enter") {
      if (!redis) {
        sendJson(res, 503, { error: "Entry storage is not configured." });
        return;
      }
      let data;
      try {
        data = parseBody(req, await readBody(req));
      } catch {
        sendJson(res, 400, { error: "Invalid form data." });
        return;
      }
      if (clean(data.company_website, 200)) {
        sendJson(res, 200, { ok: true });
        return;
      }
      const entry = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        name: clean(data.name, 120),
        school: clean(data.school, 160),
        role: clean(data.role, 120),
        email: clean(data.email, 160).toLowerCase(),
        phone: clean(data.phone, 40),
        demo: data.demo === true || data.demo === "true" || data.demo === "on",
        smsOptIn: data.smsOptIn === true || data.smsOptIn === "true" || data.smsOptIn === "on",
        deleted: false,
      };
      if (!entry.name || !entry.school || !entry.role || !entry.email) {
        sendJson(res, 400, { error: "Name, school, role, and email are required." });
        return;
      }
      if (!isEmail(entry.email)) {
        sendJson(res, 400, { error: "Please enter a valid email address." });
        return;
      }
      await redis.set(entryKey(entry.id), JSON.stringify(entry));
      await redis.lPush(IDS_KEY, entry.id);
      sendJson(res, 200, { ok: true, id: entry.id });
      return;
    }

    if (url.pathname === "/entries" || url.pathname === "/api/entries") {
      if (!isAdmin(url)) {
        send(res, 401, "Unauthorized", { "Content-Type": "text/plain; charset=utf-8" });
        return;
      }
      if (!redis) {
        send(res, 503, "Entry storage is not configured.", { "Content-Type": "text/plain; charset=utf-8" });
        return;
      }
      if (req.method === "POST" && url.searchParams.get("delete")) {
        const id = clean(url.searchParams.get("delete"), 80);
        const raw = await redis.get(entryKey(id));
        if (!raw) {
          sendJson(res, 404, { error: "Entry not found." });
          return;
        }
        const entry = JSON.parse(raw);
        entry.deleted = true;
        entry.deletedAt = new Date().toISOString();
        entry.deletedReason = clean(url.searchParams.get("reason") || "test entry", 120);
        await redis.set(entryKey(id), JSON.stringify(entry));
        sendJson(res, 200, { ok: true, id, deleted: true });
        return;
      }
      const entries = await allEntries();
      if (url.searchParams.get("download") === "csv" || url.searchParams.get("format") === "csv") {
        send(res, 200, toCsv(entries), {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": "attachment; filename=cite-raffle-entries.csv",
        });
        return;
      }
      if (url.searchParams.get("format") === "json") {
        sendJson(res, 200, { entries });
        return;
      }
      send(res, 200, entriesPage(entries), { "Content-Type": "text/html; charset=utf-8" });
      return;
    }

    send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
  } catch (err) {
    console.error(err);
    send(res, 500, "Server error", { "Content-Type": "text/plain; charset=utf-8" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`CITE raffle form listening on ${PORT}`);
});
