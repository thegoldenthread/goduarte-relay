// goduarte relay: forwards approved requests to vendors that only accept calls
// from a fixed IP address. It listens on localhost only; Caddy terminates TLS
// in front of it.
//
// Request shape:   <METHOD> /fwd/<host[:port]>/<path>?<query>
// Required header: Authorization: Bearer <lane token>
// Each lane (business or client) has its own token and may reach only the
// hosts listed for it in lanes.json.
//
// No dependencies beyond Node itself.

import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.RELAY_PORT || 8080);
const LANES_PATH = process.env.RELAY_LANES || join(here, "lanes.json");
const TOKENS_PATH = process.env.RELAY_TOKENS || "/etc/goduarte-relay/tokens.json";
const UPSTREAM_PROTOCOL = process.env.RELAY_UPSTREAM_PROTOCOL || "https"; // "http" only in tests
const MAX_BODY = 10 * 1024 * 1024; // 10 MB
const TIMEOUT_MS = 60_000;

function log(obj) {
  console.log(JSON.stringify({ t: new Date().toISOString(), ...obj }));
}

// lanes: [{ name, token: Buffer, hosts: Set }]
function loadLanes() {
  const cfg = JSON.parse(readFileSync(LANES_PATH, "utf8")).lanes;
  const tokens = JSON.parse(readFileSync(TOKENS_PATH, "utf8"));
  const lanes = [];
  for (const [name, lane] of Object.entries(cfg)) {
    const token = tokens[name];
    if (!token || token.length < 32) {
      log({ event: "lane_skipped", lane: name, reason: "missing or short token" });
      continue;
    }
    lanes.push({ name, token: Buffer.from(token), hosts: new Set(lane.hosts.map((h) => h.toLowerCase())) });
  }
  if (!lanes.length) throw new Error("no usable lanes");
  return lanes;
}

let lanes;
try {
  lanes = loadLanes();
} catch (err) {
  console.error(`Cannot start: ${err.message}`);
  process.exit(1);
}
process.on("SIGHUP", () => {
  try {
    lanes = loadLanes();
    log({ event: "lanes_reloaded", lanes: lanes.map((l) => l.name) });
  } catch (err) {
    log({ event: "reload_failed", error: err.message });
  }
});

// Headers that must not be passed through in either direction.
const HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host", "authorization",
  "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "via",
]);

function laneFor(header) {
  const m = /^Bearer (.+)$/.exec(header || "");
  if (!m) return null;
  const given = Buffer.from(m[1]);
  for (const lane of lanes) {
    if (given.length === lane.token.length && timingSafeEqual(given, lane.token)) return lane;
  }
  return null;
}

function send(res, status, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": typeof body === "string" ? "text/plain" : "application/json" });
  res.end(text);
}

const server = http.createServer((req, res) => {
  const started = Date.now();
  const url = new URL(req.url, "http://relay.local");

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { ok: true });
  }

  const m = /^\/fwd\/([^/]+)(\/.*)?$/.exec(url.pathname);
  if (!m) return send(res, 404, { error: "not_found" });

  const lane = laneFor(req.headers.authorization);
  if (!lane) {
    log({ event: "denied", reason: "token", path: url.pathname });
    return send(res, 401, { error: "unauthorized" });
  }

  const target = decodeURIComponent(m[1]).toLowerCase();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(target) || !lane.hosts.has(target)) {
    log({ event: "denied", reason: "host", lane: lane.name, host: target });
    return send(res, 403, { error: "host_not_allowed", host: target });
  }

  const [hostname, port] = target.split(":");
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) headers[k] = v;
  headers.host = target;

  const client = UPSTREAM_PROTOCOL === "http" ? http : https;
  const upstream = client.request(
    {
      hostname,
      port: port ? Number(port) : undefined,
      method: req.method,
      path: (m[2] || "/") + url.search,
      headers,
      timeout: TIMEOUT_MS,
    },
    (up) => {
      const out = {};
      for (const [k, v] of Object.entries(up.headers)) if (!HOP.has(k)) out[k] = v;
      res.writeHead(up.statusCode || 502, out);
      up.pipe(res);
      up.on("end", () =>
        log({ event: "forwarded", lane: lane.name, host: target, method: req.method, status: up.statusCode, ms: Date.now() - started }),
      );
    },
  );

  upstream.on("timeout", () => upstream.destroy(new Error("upstream timeout")));
  upstream.on("error", (err) => {
    log({ event: "upstream_error", lane: lane.name, host: target, error: err.message });
    if (!res.headersSent) send(res, 502, { error: "upstream_error" });
    else res.destroy();
  });

  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      upstream.destroy();
      if (!res.headersSent) send(res, 413, { error: "body_too_large" });
      req.destroy();
    }
  });
  req.pipe(upstream);
});

server.listen(PORT, "127.0.0.1", () => log({ event: "listening", port: PORT, lanes: lanes.map((l) => l.name) }));
