/**
 * Routes /auth/v1 -> Supabase Auth and /rest/v1 -> PostgREST, and emulates the
 * Storage API endpoints the app uses, storing objects on local disk.
 */
import { createServer, request as httpRequest } from "node:http";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { sign, verify } from "./jwt.mjs";

const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const AUTH = process.env.AUTH_URL ?? "http://127.0.0.1:9999";
const REST = process.env.REST_URL ?? "http://127.0.0.1:54330";
const SECRET = process.env.JWT_SECRET;
const STORE = process.env.STORAGE_DIR ?? path.resolve(".local-stack/storage");
mkdirSync(STORE, { recursive: true });

const MIME = { ".pdf": "application/pdf", ".md": "text/markdown", ".txt": "text/plain", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD");
  res.setHeader("Access-Control-Expose-Headers", "*");
}

function proxy(req, res, target, stripPrefix) {
  const url = new URL(target);
  const upstream = httpRequest(
    {
      hostname: url.hostname,
      port: url.port,
      method: req.method,
      path: req.url.slice(stripPrefix.length) || "/",
      headers: { ...req.headers, host: url.host },
    },
    (up) => {
      cors(res);
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: `upstream error: ${err.message}` }));
  });
  req.pipe(upstream);
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const parts = [];
    req.on("data", (c) => parts.push(c));
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", reject);
  });

function json(res, status, body) {
  cors(res);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function role(req) {
  const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  return verify(bearer, SECRET)?.role ?? null;
}

function safePath(bucket, key) {
  const p = path.resolve(STORE, bucket, key);
  if (!p.startsWith(path.resolve(STORE) + path.sep)) throw new Error("bad path");
  return p;
}

async function storage(req, res, rest) {
  const url = new URL(rest, "http://x");
  const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean); // object, ...

  // Signed download: GET /object/sign/{bucket}/{key}?token=
  if (req.method === "GET" && parts[0] === "object" && parts[1] === "sign") {
    const claims = verify(url.searchParams.get("token"), SECRET);
    const key = parts.slice(2).join("/");
    if (!claims || claims.url !== key) return json(res, 400, { message: "invalid signature" });
    const file = safePath(parts[2], parts.slice(3).join("/"));
    if (!existsSync(file)) return json(res, 404, { message: "not found" });
    const download = url.searchParams.get("download");
    cors(res);
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
      ...(download !== null ? { "content-disposition": `attachment; filename="${download || path.basename(file)}"` } : {}),
    });
    return res.end(readFileSync(file));
  }

  if (role(req) !== "service_role") return json(res, 403, { message: "service role required" });

  if (req.method === "POST" && parts[0] === "object" && parts[1] === "sign") {
    const { expiresIn = 60 } = JSON.parse((await readBody(req)).toString() || "{}");
    const key = parts.slice(2).join("/");
    const token = sign({ url: key, exp: Math.floor(Date.now() / 1000) + expiresIn }, SECRET);
    return json(res, 200, { signedURL: `/object/sign/${key}?token=${token}` });
  }
  if (req.method === "POST" && parts[0] === "object" && parts[1] === "list") {
    const { prefix = "" } = JSON.parse((await readBody(req)).toString() || "{}");
    const dir = safePath(parts[2], prefix || ".");
    if (!existsSync(dir)) return json(res, 200, []);
    const items = readdirSync(dir).map((name) => {
      const isDir = statSync(path.join(dir, name)).isDirectory();
      return { name, id: isDir ? null : name, metadata: isDir ? null : { size: statSync(path.join(dir, name)).size } };
    });
    return json(res, 200, items);
  }
  if (req.method === "DELETE" && parts[0] === "object" && parts.length === 2) {
    const { prefixes = [] } = JSON.parse((await readBody(req)).toString() || "{}");
    for (const p of prefixes) rmSync(safePath(parts[1], p), { force: true });
    return json(res, 200, prefixes.map((name) => ({ name })));
  }
  if ((req.method === "POST" || req.method === "PUT") && parts[0] === "object") {
    const file = safePath(parts[1], parts.slice(2).join("/"));
    if (existsSync(file) && req.method === "POST" && req.headers["x-upsert"] !== "true") {
      return json(res, 409, { message: "The resource already exists", statusCode: "409" });
    }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, await readBody(req));
    return json(res, 200, { Key: parts.slice(1).join("/"), Id: parts.slice(2).join("/") });
  }
  if (req.method === "GET" && parts[0] === "object") {
    const file = safePath(parts[1], parts.slice(2).join("/"));
    if (!existsSync(file)) return json(res, 404, { message: "not found" });
    cors(res);
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    return res.end(readFileSync(file));
  }
  return json(res, 404, { message: `storage emulator: unsupported ${req.method} ${url.pathname}` });
}

createServer((req, res) => {
  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    return res.end();
  }
  if (req.url.startsWith("/auth/v1")) return proxy(req, res, AUTH, "/auth/v1");
  if (req.url.startsWith("/rest/v1")) return proxy(req, res, REST, "/rest/v1");
  if (req.url.startsWith("/storage/v1")) {
    return storage(req, res, req.url.slice("/storage/v1".length)).catch((err) => json(res, 500, { message: err.message }));
  }
  json(res, 404, { message: "not found" });
}).listen(PORT, "127.0.0.1", () => console.log(`gateway listening on http://127.0.0.1:${PORT}`));
