// @bun
// index.js
import { homedir } from "os";
import { join as join2 } from "path";

// src/auth.js
import { createHash, randomBytes } from "crypto";
import { createServer as createServer2, get as httpGet } from "http";

// src/login-wizard.js
import { readFile } from "fs/promises";
import { createServer } from "http";
var listeners = new Map;
var sessions = new Map;
var maxBodyBytes = 64 * 1024;
var invalidCallback = "\u56DE\u8C03\u672A\u901A\u8FC7\u9A8C\u8BC1\u3002\u8BF7\u6838\u5BF9\u5F53\u524D\u6B65\u9AA4\uFF0C\u6216\u56DE\u5230 Magpie \u91CD\u65B0\u767B\u5F55\u3002";
var assets = new Map([
  ["/", ["wizard.html", "text/html; charset=utf-8"]],
  ["/wizard.html", ["wizard.html", "text/html; charset=utf-8"]],
  ["/wizard.js", ["wizard.js", "text/javascript; charset=utf-8"]]
]);

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function registerWizardSession(port, session) {
  const key = String(port);
  sessions.set(key, session);
  return () => {
    if (sessions.get(key) === session)
      sessions.delete(key);
  };
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      if (size > maxBodyBytes)
        return;
      size += chunk.length;
      if (size <= maxBodyBytes)
        chunks.push(chunk);
      else
        reject(new RequestError(413, "\u56DE\u8C03\u5730\u5740\u8FC7\u957F\u3002"));
    });
    req.once("end", () => {
      if (size > maxBodyBytes)
        return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new RequestError(400, "\u8BF7\u8F93\u5165\u5B8C\u6574\u7684\u56DE\u8C03\u5730\u5740\u3002"));
      }
    });
    req.once("error", reject);
  });
}
async function callback(body) {
  const { step, url: raw } = body || {};
  if (step !== 1 && step !== 2)
    throw new RequestError(400, "\u767B\u5F55\u6B65\u9AA4\u65E0\u6548\u3002");
  if (typeof raw !== "string" || !/^http:\/\/(?:127\.0\.0\.1|localhost):[1-9]\d{0,4}(?:[/?]|$)/.test(raw) || /[\\\s#]/.test(raw)) {
    throw new RequestError(400, "\u8BF7\u7C98\u8D34\u6D4F\u89C8\u5668\u5730\u5740\u680F\u4E2D\u7684\u5B8C\u6574\u672C\u673A\u56DE\u8C03\u5730\u5740\u3002");
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new RequestError(400, "\u56DE\u8C03\u5730\u5740\u683C\u5F0F\u4E0D\u6B63\u786E\u3002");
  }
  if (step === 1 && url.pathname !== "/callback") {
    throw new RequestError(400, "\u8BF7\u7C98\u8D34\u8FD9\u6B21\u767B\u5F55\u7684\u7B2C\u4E00\u4E2A\u56DE\u8C03\u5730\u5740\u3002");
  }
  if (step === 2 && url.pathname !== "/" && url.pathname !== "/index.html") {
    throw new RequestError(400, "\u8BF7\u7C98\u8D34\u5B8C\u6210 AWS \u6388\u6743\u540E\u7684\u7B2C\u4E8C\u4E2A\u56DE\u8C03\u5730\u5740\u3002");
  }
  const session = sessions.get(url.port);
  if (!session || step === 1 && url.searchParams.get("nonce") !== session.firstNonce) {
    throw new RequestError(400, invalidCallback);
  }
  let result;
  try {
    result = await session.onCallback(step, url);
  } catch {
    throw new RequestError(400, invalidCallback);
  }
  if (step === 1 && result?.step === 2 && typeof result.url === "string" && result.url.startsWith("https://")) {
    return { step: 2, url: result.url };
  }
  if (step === 2 && result?.done === true)
    return { done: true };
  throw new RequestError(400, invalidCallback);
}
function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}
async function serve(port, req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Vary", "Origin");
  const hosts = ["127.0.0.1:" + port, "localhost:" + port];
  const origin = req.headers.origin;
  if (!hosts.includes(req.headers.host) || origin !== undefined && origin !== "null" && !hosts.some((host) => origin === "http://" + host)) {
    return json(res, 403, { error: "\u8BF7\u6C42\u6765\u6E90\u65E0\u6548\u3002" });
  }
  if (origin)
    res.setHeader("Access-Control-Allow-Origin", origin);
  const path = req.url.split("?")[0];
  if (path === "/callback" && req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }
  if (path === "/callback" && req.method === "POST") {
    if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return json(res, 415, { error: "\u8BF7\u901A\u8FC7\u767B\u5F55\u5411\u5BFC\u63D0\u4EA4\u56DE\u8C03\u3002" });
    }
    return json(res, 200, await callback(await readBody(req)));
  }
  const asset = assets.get(path);
  if (req.method !== "GET" || !asset)
    return json(res, 404, { error: "\u9875\u9762\u4E0D\u5B58\u5728\u3002" });
  const [file, type] = asset;
  const bytes = await readFile(new URL("../login/" + file, import.meta.url));
  const loopback = "http://127.0.0.1:" + port;
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Security-Policy": [
      "default-src 'none'",
      "script-src 'self' " + loopback + "/wizard.js",
      "style-src 'unsafe-inline'",
      "connect-src 'self' " + loopback + "/callback",
      "base-uri 'none'",
      "form-action 'none'"
    ].join("; ")
  });
  res.end(bytes);
}
function startLoginWizard(port) {
  if (listeners.has(port))
    return listeners.get(port);
  const ready = new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      serve(req.socket.localPort, req, res).catch((err) => {
        if (res.destroyed || res.writableEnded)
          return;
        if (err instanceof RequestError)
          json(res, err.status, { error: err.message });
        else
          json(res, 500, { error: "\u767B\u5F55\u5411\u5BFC\u6682\u65F6\u4E0D\u53EF\u7528\u3002" });
      });
    });
    server.once("close", () => {
      if (listeners.get(port) === ready)
        listeners.delete(port);
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.unref();
      resolve(server);
    });
  }).catch((err) => {
    if (listeners.get(port) === ready)
      listeners.delete(port);
    throw err;
  });
  listeners.set(port, ready);
  return ready;
}
// package.json
var package_default = {
  name: "magpie-amazon-quick",
  version: "1.3.1",
  description: "Amazon Quick subscription provider for Magpie",
  magpie: {
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0NCA0NCI+PHN0eWxlPnBhdGh7ZmlsbDojMWMxYzFlfUBtZWRpYSAocHJlZmVycy1jb2xvci1zY2hlbWU6ZGFyayl7cGF0aHtmaWxsOiNmMmYyZjJ9fTwvc3R5bGU+PHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBkPSJNMS41IDUuNUMxLjMgNS43IDEuMiA2LjUgMS4yIDYuOUMxLjIgNi45IDEuMiA3IDEuMiA3LjFDMS4xIDcuNCAxLjMgOCAxLjQgOC4zQzEuNCA4LjQgMS41IDguNSAxLjUgOC43QzEuNSA4LjkgMS43IDkgMS44IDkuM0MyLjIgOS45IDIuMiAxMCAyLjMgMTAuMUMyLjQgMTAuMiAyLjUgMTAuMyAyLjYgMTAuNUMyLjggMTAuOCAzIDExLjEgMy4yIDExLjNDMy4zIDExLjMgMy40IDExLjYgMy42IDExLjhDMy44IDEyIDQuMSAxMi40IDQuMiAxMi41QzQuNyAxMyA1LjIgMTMuNyA1LjQgMTMuOUM2IDE0LjUgNi41IDE1LjEgNi43IDE1LjNDNi43IDE1LjQgNi45IDE1LjUgNi45IDE1LjdDNy4zIDE1LjkgNy43IDE2LjUgNy45IDE2LjhDNy45IDE2LjggOCAxNi45IDggMTYuOUM4LjEgMTYuOSA4LjIgMTcuMiA4LjIgMTcuM0M4LjIgMTcuMyA4LjEgMTcuMiA4LjEgMTcuMUM3LjkgMTYuOSA3LjkgMTYuOSA3LjYgMTYuNkM3LjUgMTYuNSA3LjQgMTYuNSA3LjQgMTYuM0M3LjIgMTYuMiA2LjcgMTUuNyA2LjMgMTUuMkM2LjEgMTUuMSA2IDE0LjkgNiAxNC45QzUuOSAxNC44IDUuNyAxNC43IDUuNyAxNC42QzUuNiAxNC41IDUuNCAxNC4zIDUuMyAxNC4yQzUuMSAxNC4xIDQuOSAxMy44IDQuNyAxMy41QzQuNSAxMy4zIDQuMiAxMy4xIDQuMSAxMi45QzQuMSAxMi45IDMuOCAxMi43IDMuOCAxMi41QzMuNSAxMi4zIDMgMTEuOCAyLjggMTEuNEMxLjggMTAuNSAwLjkgOS42IDAuNyA5LjZDMC42IDkuNyAwLjYgOS44IDAuNSAxMEMwLjUgMTAuMSAwLjYgMTAuMiAwLjUgMTAuM0MwLjUgMTAuNCAwLjYgMTAuNSAwLjYgMTAuNkMwLjUgMTAuNyAwLjUgMTAuOSAwLjYgMTFDMC41IDExLjEgMC42IDExLjQgMC42IDExLjVDMC45IDEyLjkgMS4zIDEzLjggMi44IDE0LjlDMi45IDE1LjEgMy4zIDE1LjMgMy40IDE1LjRDMy40IDE1LjUgMy42IDE1LjYgMy43IDE1LjdDNC4yIDE2IDYuNCAxNy44IDcgMTguNEM3LjQgMTguOCA3LjQgMTguOCA3LjUgMTguOUM3LjYgMTkgNy43IDE5IDcuNyAxOS4xQzcuNyAxOS4yIDcuOCAxOS4yIDcuOSAxOS4yQzcuOSAxOS4zIDguMSAxOS40IDguMSAxOS41QzguMiAxOS42IDguMiAxOS43IDguMyAxOS43QzguMyAxOS43IDguMyAxOS43IDguMiAxOS43QzguMiAxOS42IDguMSAxOS42IDggMTkuNkM3LjkgMTkuNSA3LjkgMTkuNCA3LjggMTkuNEM3LjcgMTkuMyA3LjYgMTkuMiA3LjYgMTkuMkM3LjYgMTkuMSA3LjUgMTkgNy4zIDE4LjlDNy4yIDE4LjkgNi45IDE4LjYgNi43IDE4LjRDNi4xIDE3LjggNC41IDE2LjYgMy41IDE2QzMuNCAxNS44IDMgMTUuNiAyLjkgMTUuNUMyLjYgMTUuMyAxLjUgMTQuNiAwLjkgMTQuM0MwLjcgMTQuMSAwLjYgMTQuMSAwLjYgMTQuMkMwLjUgMTQuNSAwLjggMTUuOSAwLjkgMTYuMUMwLjkgMTYuMiAxIDE2LjIgMC45IDE2LjNDMS4yIDE2LjggMS45IDE3LjYgMi43IDE4LjNDMi44IDE4LjUgNCAxOS4yIDQuNyAxOS41QzYuMiAyMC41IDYuNiAyMC43IDcuNCAyMS41QzguMiAyMi4yIDguNyAyMi43IDkuMyAyMy42QzkuNSAyNC4xIDkuOSAyNC40IDEwLjMgMjUuM0MxMC40IDI1LjUgMTAuNSAyNS44IDEwLjUgMjUuOEMxMC43IDI1LjggMTAuOCAyNS43IDExIDI1LjRDMTEuNiAyNSAxMS45IDI0LjYgMTIuMyAyNC4zQzEyLjggMjQgMTMgMjMuOCAxMyAyMy43QzEzLjEgMjMuNyAxMy4xIDIzLjggMTMgMjRDMTIgMjQuOCAxMSAyNiAxMC4yIDI2LjlDMTAuMSAyNy4xIDkuOSAyNy41IDkuNyAyNy43QzkuNSAyNy44IDkuNCAyOCA5LjQgMjhDOS40IDI4IDkuMyAyOC4zIDkuMSAyOC41QzguNiAyOS4yIDcuNyAzMC44IDcuNyAzMC45QzcuNyAzMSA3LjggMzEgOC4zIDMwLjhDOSAzMC40IDkuNSAzMC4yIDEwLjQgMzBDMTEuNyAyOS42IDEyLjUgMjkuNiAxMS42IDMwQzEwLjUgMzAuMiA5LjcgMzAuNiA5LjIgMzEuMkM4LjggMzEuNyA4LjggMzEuNyA5LjMgMzEuN0MxMC4xIDMxLjggMTAuOSAzMS45IDExLjYgMzIuMkMxMi44IDMyLjcgMTMuNSAzMy4xIDE1LjUgMzQuOEMxNi40IDM1LjUgMTcuMyAzNi4yIDE3LjggMzYuNEMxNy45IDM2LjUgMTguMSAzNi43IDE4LjIgMzYuOEMxOS4xIDM3LjMgMjEuMiAzOC4xIDIyLjMgMzguM0MyMi40IDM4LjMgMjIuNyAzOC4zIDIyLjggMzguM0MyMi44IDM4LjUgMjMgMzguNSAyMyAzOC41QzIzLjEgMzguNSAyMy4yIDM4LjUgMjMuMyAzOC41QzIzLjYgMzguNiAyNS45IDM4LjYgMjYuMSAzOC41QzI2LjIgMzguNSAyNi4zIDM4LjUgMjYuNCAzOC41QzI2LjUgMzguNSAyNi42IDM4LjUgMjYuNyAzOC4zQzI2LjcgMzguMyAyNyAzOC4zIDI3LjEgMzguM0MyOC4zIDM4LjEgMzAuMiAzNy4zIDMxLjQgMzYuN0MzMS41IDM2LjcgMzEuNyAzNi40IDMxLjggMzYuNEMzMi4yIDM2LjIgMzMuMiAzNS40IDMzLjQgMzUuMkMzNC4yIDM0LjUgMzUuNSAzMyAzNS44IDMyLjZDMzUuOCAzMi41IDM2IDMyLjIgMzYuMSAzMkMzNi40IDMxLjggMzYuNiAzMS40IDM2LjYgMzEuMkMzNi43IDMxLjEgMzYuOCAzMC45IDM2LjkgMzAuOEMzNy4yIDMwLjQgMzcuNSAyOS42IDM3LjcgMjkuMkMzNy43IDI5LjEgMzcuOCAyOC43IDM3LjkgMjguN0MzOC4xIDI4LjUgMzguNCAyNy4xIDM4LjUgMjYuOEMzOSAyNS4yIDM5LjEgMjMuNyAzOSAyMi40QzM5IDIyLjIgMzguOSAyMS45IDM4LjkgMjEuOEMzOC45IDIxLjcgMzguOSAyMS42IDM4LjkgMjEuNEMzOC42IDIwLjUgMzguNSAxOS45IDM4LjIgMTlDMzcuOSAxOC41IDM3LjUgMTcuNSAzNy4zIDE3LjJDMzcgMTYuOCAzNi44IDE1LjggMzYuOCAxNS4yQzM2LjggMTMuOCAzNy43IDEyLjcgMzkuNiAxMi4yQzQwLjEgMTIuMSA0MS4zIDExLjggNDIuMSAxMS43QzQzLjUgMTEuNSA0My41IDExLjUgNDMuNCAxMS4zQzQyLjkgMTAuNyA0MC45IDkuOSAzOS4yIDkuN0MzNy45IDkuNSAzOC4xIDkuNSAzNy42IDlDMzcgOC42IDM2LjQgOCAzNiA3LjlDMzYgNy44IDM1LjggNy44IDM1LjcgNy43QzM1LjEgNy4zIDM0LjIgNyAzMy4xIDYuOUMzMi42IDYuNyAzMS42IDYuOSAzMSA3QzI5LjYgNy4zIDI4LjMgOCAyNy4zIDkuMkMyNi43IDkuOCAyNi4yIDEwLjggMjUuNyAxMS43QzI1LjUgMTIuMSAyNC44IDEzLjQgMjQuNyAxMy43QzI0LjYgMTMuOSAyNC41IDE0LjEgMjQuMSAxNC43QzIzLjUgMTUuNyAyMi4xIDE2LjkgMjAuNiAxNy44QzIwLjUgMTggMjAuMyAxOC4yIDIwLjEgMTguM0MxOS43IDE4LjUgMTkuNCAxOC44IDE5LjEgMTlDMTguOSAxOS4xIDE4LjcgMTkuMyAxOC41IDE5LjRDMTggMTkuOCAxNy4yIDIwLjMgMTcgMjAuNUMxNi45IDIwLjUgMTYuOCAyMC42IDE2LjcgMjAuN0MxNi4zIDIwLjggMTYuMSAyMC45IDE2IDIwLjlDMTUuNSAyMC44IDE0LjkgMjAuNSAxNC4yIDIwLjJDMTMuNyAxOS44IDEyLjcgMTguOSAxMi40IDE4LjZDMTIuMyAxOC41IDEyLjIgMTguNCAxMi4xIDE4LjJDMTEuOSAxOCAxMS4yIDE3LjEgMTEgMTYuNkMxMC45IDE2LjUgMTAuOCAxNi40IDEwLjcgMTYuM0MxMC43IDE2LjIgMTAuNiAxNi4xIDEwLjYgMTUuOUMxMC41IDE1LjkgMTAuNCAxNS43IDEwLjQgMTUuNkMxMC4zIDE1LjUgMTAuMiAxNS4yIDEwLjEgMTVDMTAgMTQuOCA5LjggMTQuNCA5LjcgMTQuMkM5LjYgMTQgOS41IDEzLjcgOS40IDEzLjZDOS40IDEzLjQgOS4zIDEzLjIgOS4yIDEzQzkuMiAxMi44IDkgMTIuNiA5IDEyLjVDOC45IDEyLjMgOC43IDEyLjEgOC43IDEyQzguNyAxMiA4LjUgMTEuNyA4LjUgMTEuN0M4LjMgMTEuMiA4LjIgMTAuOSA3LjUgMTBDNi40IDguMyA0LjIgNi40IDIuNyA1LjhDMiA1LjUgMS42IDUuNCAxLjUgNS41Wk0yOC40IDE2LjdDMjkuMiAxNi45IDI5LjcgMTcuMiAyOS45IDE3LjdDMzAuMSAxOC4yIDMwIDE4LjkgMjkuNiAxOS40QzI5LjIgMTkuOSAyOC4yIDIwLjkgMjcuNiAyMS4yQzI2LjggMjEuNyAyNS4zIDIyLjQgMjQuMiAyMi43QzIzLjkgMjIuOCAyMy42IDIyLjkgMjMuNSAyMi45QzIyLjggMjMuMiAyMC43IDIzLjcgMTkuNiAyNEMxOSAyNC4yIDE4LjQgMjQuMyAxOC4xIDI0LjRDMTcuOSAyNC40IDE2LjEgMjQuOSAxNS4zIDI1LjFDMTQuNiAyNS4yIDE0LjcgMjUuMSAxNS43IDIzLjZDMTYuNCAyMi43IDE4LjUgMjAuNiAxOS40IDE5LjlDMjAuOCAxOC44IDIxLjQgMTguNCAyMy4yIDE3LjZDMjMuOCAxNy40IDI1LjYgMTYuOCAyNS45IDE2LjhDMjUuOSAxNi44IDI2LjMgMTYuOCAyNi42IDE2LjdDMjYuOCAxNi43IDI4LjIgMTYuNyAyOC40IDE2LjdaTTMwLjQgMjAuMkMzMC41IDIwLjMgMzAuNiAyMC42IDMwLjYgMjAuN0MzMS43IDIzLjEgMzMuNCAyNC42IDM1LjYgMjUuM0MzNi4xIDI1LjUgMzYuNyAyNS43IDM3LjIgMjUuOEMzNy43IDI1LjggMzcuOCAyNS45IDM3LjggMjYuMUMzNy43IDI2LjIgMzcuNyAyNi4zIDM3LjcgMjYuNUMzNy43IDI2LjYgMzcuNyAyNi44IDM3LjYgMjdDMzcuNCAyOC41IDM2LjggMjkuOSAzNi4xIDMxQzM2LjEgMzEuMiAzNS45IDMxLjQgMzUuOSAzMS42QzM1LjcgMzEuOSAzNS4yIDMyLjYgMzQuNyAzMy4zQzMyLjYgMzUuNiAyOS43IDM3LjMgMjYuNiAzNy44QzI2LjUgMzcuOCAyNi4zIDM3LjkgMjYuMiAzNy45QzI1LjggMzcuOSAyMy43IDM3LjkgMjMuMyAzNy45QzIzLjIgMzcuOSAyMyAzNy44IDIyLjkgMzcuOEMyMS4xIDM3LjYgMTkuMyAzNi44IDE4IDM1LjdDMTcuNyAzNS40IDE3IDM0LjcgMTYuOCAzNC41QzE2LjMgMzMuOCAxNi4xIDMzIDE2LjMgMzIuNUMxNi41IDMxLjggMTYuOCAzMS42IDE3LjkgMzEuMUMxOS4xIDMwLjUgMTkuNCAzMC40IDIwLjIgMzBDMjEuNCAyOS40IDIzLjIgMjguNCAyMy45IDI3LjlDMjMuOSAyNy44IDI0LjIgMjcuNyAyNC41IDI3LjZDMjYuMyAyNi4zIDI4IDI0LjYgMjguOSAyMi45QzI5LjUgMjIuMiAyOS43IDIxLjYgMjkuOSAyMC43QzMwLjEgMjAgMzAuMiAxOS45IDMwLjQgMjAuMloiLz48L3N2Zz4K",
    page: {
      title: "Quick \u767B\u5F55",
      file: "login/index.html",
      service: { port: 43871, option: "loginWizardPort" }
    },
    panels: [
      {
        slot: "settings",
        file: "settings/index.html",
        title: "Amazon Quick"
      }
    ],
    options: {
      monthlyHours: 10,
      loginWizardPort: 43871,
      transport: "aidp",
      appVersion: "1.2.4660",
      region: "",
      timezone: "UTC",
      locale: "en-US",
      surface: "QUICK_WORK_DESKTOP_WINDOWS",
      requestTimeoutSeconds: 300,
      thinkingEffort: "off",
      keepSessions: false,
      outpostId: "",
      workingSessionId: ""
    }
  },
  type: "module",
  main: "./dist/amazon-quick.mjs",
  exports: {
    ".": "./dist/amazon-quick.mjs"
  },
  files: [
    "dist",
    "index.js",
    "src",
    "settings",
    "login",
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES"
  ],
  license: "GPL-3.0-only",
  scripts: {
    build: "bun build index.js --target=bun --format=esm --outfile=dist/amazon-quick.mjs && bun build src/settings-panel.js --target=browser --format=iife --outfile=settings/settings.js",
    test: "node --test test/*.test.js"
  },
  devDependencies: {
    cborg: "7.0.0",
    ws: "8.23.0"
  }
};

// src/options.js
var defaultOptions = Object.freeze(package_default.magpie.options);
var regionPattern = /^[a-z]{2}(?:-[a-z0-9]+)+-[0-9]+$/;
var versionPattern = /^\d+(?:\.\d+){1,3}(?:-[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)?(?:\+[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)?$/;
function invalid(field, message) {
  throw Object.assign(new TypeError(message), { field });
}
function readOptions(options = {}) {
  const values = {};
  for (const [field, fallback] of Object.entries(defaultOptions)) {
    const value = options[field] ?? fallback;
    if (typeof value !== typeof fallback)
      invalid(field, field + " \u7684\u503C\u7C7B\u578B\u4E0D\u6B63\u786E\u3002");
    values[field] = typeof value === "string" ? value.trim() : value;
  }
  if (!Number.isFinite(values.monthlyHours * 3600000) || values.monthlyHours <= 0) {
    invalid("monthlyHours", "\u8BF7\u8F93\u5165\u5927\u4E8E 0 \u7684\u6709\u6548\u5C0F\u65F6\u6570\u3002");
  }
  if (!Number.isInteger(values.loginWizardPort) || values.loginWizardPort < 1024 || values.loginWizardPort > 65535) {
    invalid("loginWizardPort", "\u767B\u5F55\u5411\u5BFC\u7AEF\u53E3\u987B\u4E3A 1024 \u81F3 65535 \u7684\u6574\u6570\u3002");
  }
  if (!["aidp", "gateway"].includes(values.transport))
    invalid("transport", "\u8BF7\u9009\u62E9 AIDP \u6216 Quick Gateway\u3002");
  if (values.appVersion.length > 64 || !versionPattern.test(values.appVersion)) {
    invalid("appVersion", "\u8BF7\u8F93\u5165 Quick App \u7248\u672C\u53F7\uFF0C\u4F8B\u5982 1.2.4660\u3002");
  }
  if (values.region && !regionPattern.test(values.region))
    invalid("region", "\u8BF7\u8F93\u5165 AWS \u533A\u57DF\u4EE3\u7801\uFF0C\u4F8B\u5982 us-east-1\u3002");
  if (!/^[A-Za-z0-9._-]+$/.test(values.surface))
    invalid("surface", "\u5BA2\u6237\u7AEF\u6807\u8BC6\u53EF\u4F7F\u7528\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u70B9\u3001\u4E0B\u5212\u7EBF\u548C\u8FDE\u5B57\u7B26\u3002");
  for (const key of ["outpostId", "workingSessionId"]) {
    if (!/^[\x21-\x7e]*$/.test(values[key]))
      invalid(key, "\u6B64\u6807\u8BC6\u53EA\u80FD\u5305\u542B\u4E0D\u5E26\u7A7A\u683C\u7684 ASCII \u53EF\u89C1\u5B57\u7B26\u3002");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: values.timezone });
  } catch {
    invalid("timezone", "\u8BF7\u8F93\u5165\u6709\u6548\u65F6\u533A\uFF0C\u4F8B\u5982 Asia/Taipei\u3002");
  }
  try {
    values.locale = Intl.getCanonicalLocales(values.locale)[0];
  } catch {
    invalid("locale", "\u8BF7\u8F93\u5165\u6709\u6548\u8BED\u8A00\u6807\u7B7E\uFF0C\u4F8B\u5982 zh-TW\u3002");
  }
  if (!["off", "low", "medium", "high"].includes(values.thinkingEffort))
    invalid("thinkingEffort", "\u8BF7\u9009\u62E9\u6709\u6548\u7684\u601D\u8003\u5F3A\u5EA6\u3002");
  if (!Number.isSafeInteger(values.requestTimeoutSeconds) || values.requestTimeoutSeconds < 1 || values.requestTimeoutSeconds > 2147483) {
    invalid("requestTimeoutSeconds", "\u8BF7\u6C42\u8D85\u65F6\u987B\u4E3A 1 \u81F3 2147483 \u79D2\u7684\u6574\u6570\u3002");
  }
  return values;
}

// src/auth.js
var dataPlane = "https://cell001.dp.appintegrations.us-east-1.prod.plato.ai.aws.dev";
var scopes = ["quicksight:read_write"];
var refreshing = new Map;
function isQuickHost(host) {
  return ["quick.aws.com", "quicksight.aws.amazon.com", "plato.ai.aws.dev", "quicksuite.aws.dev"].some((domain) => host === domain || host.endsWith("." + domain));
}
function isIdpHost(host) {
  const oidc = /^oidc\.(.+)\.amazonaws\.com$/.exec(host);
  return isQuickHost(host) || oidc && regionPattern.test(oidc[1]) || ["login.microsoftonline.com", "accounts.google.com", "oauth2.googleapis.com"].includes(host) || (process.env.AMAZON_QUICK_IDP_HOSTS || "").split(",").some((value) => value.trim().toLowerCase() === host);
}
function checkedURL(value, acceptsHost) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Amazon Quick returned an invalid service URL");
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || !acceptsHost(url.hostname)) {
    throw new Error("Untrusted Amazon Quick service URL");
  }
  return url;
}
function required(value, label) {
  if (typeof value !== "string" || !value.trim())
    throw new Error("Missing " + label);
  return value;
}
async function post(endpoint, payload, action, signal, bearer) {
  const form = payload instanceof URLSearchParams;
  const headers = { Accept: "application/json", "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json" };
  if (bearer)
    headers.Authorization = "Bearer " + bearer;
  const timeout = AbortSignal.timeout(30000);
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: form ? payload : JSON.stringify(payload),
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    });
  } catch {
    throw new Error(action + " request failed");
  }
  if (!response.ok) {
    const error = Object.assign(new Error(action + " failed (HTTP " + response.status + ")"), { status: response.status });
    if (action === "Token refresh" && [400, 401, 403].includes(response.status)) {
      const details = await response.json().catch(() => null);
      if (["invalid_grant", "expired_token", "invalid_client", "unauthorized_client"].includes(details?.error)) {
        error.signIn = "expired";
        error.status = 401;
      } else if (details?.error === "slow_down")
        error.status = 429;
    }
    throw error;
  }
  try {
    return await response.json();
  } catch {
    throw new Error(action + " returned malformed JSON");
  }
}
function jwtClaims(jwt) {
  try {
    return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
  } catch {
    return {};
  }
}
function tokenRecord(meta, tokens) {
  const jwt = tokens.idToken || tokens.id_token || tokens.accessToken || tokens.access_token;
  required(jwt, "Amazon Quick token");
  const seconds = Number(tokens.expires_in ?? tokens.expiresIn);
  const expires = seconds > 0 ? Date.now() + seconds * 1000 : Number(jwtClaims(jwt)?.exp) * 1000;
  if (!Number.isFinite(expires) || expires <= Date.now())
    throw new Error("Missing or expired Amazon Quick token lifetime");
  const refreshToken = tokens.refreshToken || tokens.refresh_token || meta.refreshToken || "";
  return {
    type: "oauth",
    access: jwt,
    expires,
    refresh: JSON.stringify({ ...meta, refreshToken }),
    uid: meta.accountId,
    accountId: meta.email || meta.accountId
  };
}
function readMeta(auth) {
  if (auth?.type !== "oauth" || !auth.access)
    throw Object.assign(new Error("Please sign in to Amazon Quick"), { status: 401 });
  let meta;
  try {
    meta = JSON.parse(auth.refresh);
  } catch {
    throw new Error("Invalid Amazon Quick credentials; sign in again");
  }
  if (!meta || !["social", "enterprise"].includes(meta.provider))
    throw new Error("Invalid Amazon Quick sign-in method");
  checkedURL(meta.tenant, isQuickHost);
  const endpoint = checkedURL(meta.tokenEndpoint, isIdpHost);
  if (meta.provider === "social" && !/^https:\/\/oidc\.[a-z0-9-]+\.amazonaws\.com\/token$/.test(endpoint.href)) {
    throw new Error("Untrusted AWS Identity Center token endpoint");
  }
  required(meta.clientId, "Amazon Quick client ID");
  required(meta.accountId, "Amazon Quick account ID");
  return meta;
}
function sessionFromAuth(auth) {
  const meta = readMeta(auth);
  return {
    jwt: auth.access,
    wsHost: new URL(meta.tenant).hostname,
    wsPath: "",
    provider: meta.provider,
    actorArn: meta.actorArn,
    accountId: meta.accountId,
    email: meta.email
  };
}
function exchange(meta, grant, signal) {
  const action = grant.code ? "Token exchange" : "Token refresh";
  if (meta.provider === "enterprise") {
    const form = new URLSearchParams({ client_id: meta.clientId });
    if (meta.clientSecret)
      form.set("client_secret", meta.clientSecret);
    if (grant.code) {
      form.set("grant_type", "authorization_code");
      form.set("code", grant.code);
      form.set("redirect_uri", grant.redirect);
      form.set("code_verifier", grant.verifier);
    } else {
      form.set("grant_type", "refresh_token");
      form.set("refresh_token", meta.refreshToken);
    }
    return post(meta.tokenEndpoint, form, action, signal);
  }
  const payload = { clientId: meta.clientId, clientSecret: meta.clientSecret };
  if (grant.code) {
    Object.assign(payload, { grantType: "authorization_code", code: grant.code, codeVerifier: grant.verifier, redirectUri: grant.redirect });
  } else {
    Object.assign(payload, { grantType: "refresh_token", refreshToken: meta.refreshToken });
  }
  return post(meta.tokenEndpoint, payload, action, signal);
}
async function getSession(getAuth, saveAuth) {
  const auth = await getAuth();
  if (!auth || auth.type !== "oauth")
    throw Object.assign(new Error("Please sign in to Amazon Quick"), { status: 401 });
  const lead = readMeta(auth).refreshToken ? 60000 : 0;
  if (auth.expires > Date.now() + lead)
    return sessionFromAuth(auth);
  let pending = refreshing.get(auth.refresh);
  if (!pending) {
    pending = (async () => {
      const next = await refreshAuth(auth);
      await saveAuth(next);
      return next;
    })().finally(() => refreshing.delete(auth.refresh));
    refreshing.set(auth.refresh, pending);
  }
  return sessionFromAuth(await pending);
}
async function refreshAuth(auth) {
  const meta = readMeta(auth);
  if (typeof meta.refreshToken !== "string" || !meta.refreshToken.trim()) {
    const error = Object.assign(new Error("This Amazon Quick account has no refresh token; sign in again to renew it"), { status: 401 });
    if (!(auth.expires > Date.now()))
      error.signIn = "expired";
    throw error;
  }
  return tokenRecord(meta, await exchange(meta, {}));
}
function discoveryURL(provider, nonce, port, region, appVersion) {
  const enterpriseHost = (region === "us-east-1" ? "" : region + ".") + "quicksight.aws.amazon.com";
  const url = new URL(provider === "enterprise" ? "https://" + enterpriseHost + "/sn/start/app-integrations/quickwork-enterprise-login" : "https://quick.aws.com/sn");
  url.searchParams.set("qwSurface", "desktop:" + nonce + ":" + port + ":" + appVersion);
  url.searchParams.set("magpie_callback_port", String(port));
  return url.href;
}
async function discover(provider, query, region, redirect, signal) {
  const field = (...names) => names.map((name) => query.get(name)).find(Boolean);
  const tenantURL = field("tenantUrl", "tenant_url") || provider === "social" && dataPlane;
  const tenant = checkedURL(tenantURL, isQuickHost);
  if (tenant.search)
    throw new Error("Invalid Amazon Quick tenant URL");
  const meta = { provider, tenant: tenant.href.replace(/\/+$/, "") };
  let authorize;
  if (provider === "enterprise") {
    authorize = checkedURL(field("authEndpoint", "auth_endpoint"), isIdpHost);
    meta.tokenEndpoint = checkedURL(field("tokenEndpoint", "token_endpoint"), isIdpHost).href;
    meta.clientId = required(field("clientId", "client_id"), "client ID");
    meta.clientSecret = field("clientSecret", "client_secret") || "";
  } else {
    const idcRegion = field("idcRegion", "idc_region") || region;
    if (!regionPattern.test(idcRegion))
      throw new Error("Invalid AWS region");
    const oidc = "https://oidc." + idcRegion + ".amazonaws.com";
    const issuer = checkedURL(field("issuerUrl", "issuer_url", "issuer"), () => true);
    const client = await post(oidc + "/client/register", {
      clientName: "AmazonQuick-Desktop",
      clientType: "public",
      scopes,
      grantTypes: ["authorization_code", "refresh_token"],
      redirectUris: [redirect],
      issuerUrl: issuer.href
    }, "Client registration", signal);
    authorize = new URL(oidc + "/authorize");
    meta.tokenEndpoint = oidc + "/token";
    meta.clientId = required(client.clientId || client.client_id, "client ID");
    meta.clientSecret = required(client.clientSecret || client.client_secret, "client secret");
  }
  return { meta, authorize };
}
async function signIn(provider, { appVersion = defaultOptions.appVersion, region: configuredRegion }, options = {}, wizardAvailable) {
  const region = configuredRegion || process.env.AMAZON_QUICK_REGION || "us-east-1";
  if (!regionPattern.test(region))
    throw new Error("Invalid Amazon Quick login region");
  options.signal?.throwIfAborted();
  const nonce = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const lifetime = new AbortController;
  let settle;
  const result = new Promise((resolve) => {
    settle = resolve;
  });
  let discovery, redeemed = false, redirect, port;
  const server = createServer2(async (req, res) => {
    const reply = (status, body = "") => {
      res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      res.end(body);
    };
    if (lifetime.signal.aborted)
      return reply(410);
    const hosts = ["localhost:" + port, "127.0.0.1:" + port];
    if (req.method !== "GET" || !hosts.includes(req.headers.host))
      return reply(400);
    try {
      const url = new URL(req.url, redirect);
      if (url.protocol !== "http:" || url.username || url.password || !hosts.includes(url.host))
        return reply(400);
      const q = url.searchParams;
      if (url.pathname === "/callback") {
        if (q.get("nonce") !== nonce)
          return reply(400, "Invalid discovery callback");
        if (q.has("error"))
          throw new Error("Amazon Quick declined sign-in");
        discovery ??= discover(provider, q, region, redirect, lifetime.signal);
        const { meta, authorize } = await discovery;
        const params = {
          response_type: "code",
          client_id: meta.clientId,
          redirect_uri: redirect,
          state,
          code_challenge: challenge,
          code_challenge_method: "S256",
          scope: provider === "social" ? scopes.join(" ") : "openid profile email"
        };
        if (provider === "enterprise")
          Object.assign(params, { access_type: "offline", prompt: "consent" });
        for (const [key, value] of Object.entries(params))
          authorize.searchParams.set(key, value);
        res.writeHead(302, { Location: authorize.href, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
        res.end();
      } else if (url.pathname === "/" || url.pathname === "/index.html") {
        if (q.get("state") !== state || !discovery)
          return reply(400, "Invalid sign-in callback");
        if (q.has("error"))
          throw new Error("Amazon Quick declined sign-in");
        if (!q.get("code"))
          return reply(400, "Missing authorization code");
        if (redeemed)
          return reply(409, "Sign-in already in progress");
        redeemed = true;
        const { meta } = await discovery;
        const tokens = await exchange(meta, { code: q.get("code"), verifier, redirect }, lifetime.signal);
        const access = required(tokens.accessToken || tokens.access_token, "access token");
        const profileBase = provider === "enterprise" || meta.tenant.includes("dp.appintegrations") ? meta.tenant : dataPlane;
        const response = await post(profileBase + "/integration/quick-work/user-info", {}, "Account lookup", lifetime.signal, access);
        const profile = response.userInfo || response.user_info || response;
        const sub = jwtClaims(tokens.idToken || tokens.id_token || "")?.sub;
        meta.actorArn = profile.userArn || profile.user_arn || (typeof sub === "string" && sub.startsWith("arn:") ? sub : "");
        meta.email = profile.email || profile.emailAddress || profile.email_address || "";
        const identity = required(meta.actorArn || sub || meta.email.toLowerCase() || profile.userName || profile.user_name || profile.username, "account identity");
        meta.accountId = createHash("sha256").update(meta.tenant + "\x00" + identity).digest("hex");
        const saved = tokenRecord(meta, tokens);
        reply(200, "Amazon Quick \u767B\u5F55\u6210\u529F\uFF0C\u53EF\u4EE5\u5173\u95ED\u6B64\u9875\u9762\u3002");
        finish({ ...saved, type: "success" });
      } else {
        reply(404);
      }
    } catch (err) {
      reply(400, "Amazon Quick \u767B\u5F55\u5931\u8D25\uFF0C\u8BF7\u8FD4\u56DE Magpie\u3002");
      finish({ type: "failed", error: err instanceof Error ? err.message : "Amazon Quick sign-in failed" });
    }
  });
  let timer, callbackSignal, unregisterWizard;
  const abort = () => finish({ type: "failed", error: "Amazon Quick sign-in cancelled or timed out" });
  function finish(value) {
    if (lifetime.signal.aborted)
      return;
    unregisterWizard?.();
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    callbackSignal?.removeEventListener("abort", abort);
    lifetime.abort();
    server.close();
    settle(value);
  }
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  server.on("error", () => finish({ type: "failed", error: "Amazon Quick callback listener failed" }));
  port = server.address().port;
  redirect = "http://" + (provider === "enterprise" ? "localhost:" : "127.0.0.1:") + port;
  if (wizardAvailable) {
    unregisterWizard = registerWizardSession(port, {
      firstNonce: nonce,
      async onCallback(step, url) {
        if (step === 2 && (!discovery || url.searchParams.get("state") !== state))
          throw new Error("Invalid authorization callback");
        return new Promise((resolve, reject) => {
          const request = httpGet({ hostname: "127.0.0.1", port, path: url.pathname + url.search, agent: false }, (response) => {
            response.resume();
            if (step === 1 && response.statusCode === 302 && response.headers.location) {
              resolve({ step: 2, url: response.headers.location });
            } else if (step === 2 && response.statusCode === 200)
              resolve({ done: true });
            else
              reject(new Error("Callback rejected"));
          });
          request.on("error", reject);
        });
      }
    });
  }
  timer = setTimeout(abort, 10 * 60000);
  timer.unref?.();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted)
    abort();
  return {
    url: discoveryURL(provider, nonce, port, region, appVersion),
    method: "auto",
    opened: true,
    instructions: wizardAvailable ? "\u590D\u5236\u4E0B\u65B9\u767B\u5F55\u94FE\u63A5\uFF0C\u7528\u65E0\u75D5\u7A97\u53E3\u6216\u5176\u4ED6\u6D4F\u89C8\u5668\u767B\u5F55 AWS\u3002\u4E24\u6761\u56DE\u8C03\u90FD\u7C98\u8D34\u5230 Magpie \u5DE6\u4FA7\u7684\u300CQuick \u767B\u5F55\u300D\u5411\u5BFC\uFF0C\u90A3\u91CC\u4F1A\u663E\u793A\u5F53\u524D\u6B65\u9AA4\u3002" : "\u590D\u5236\u4E0B\u65B9\u767B\u5F55\u94FE\u63A5\uFF0C\u7528\u4F60\u9009\u62E9\u7684\u6D4F\u89C8\u5668\u6216\u65E0\u75D5\u7A97\u53E3\u6253\u5F00\u3002" + "\u5982\u679C\u56DE\u8C03\u9875\u9762\u6253\u4E0D\u5F00\uFF0C\u628A\u5730\u5740\u680F\u91CC\u7684\u5B8C\u6574\u5730\u5740\u7C98\u8D34\u5230 Magpie \u7684\u56DE\u8C03\u8F93\u5165\u6846\u5E76\u63D0\u4EA4\u3002" + "\u7B49\u94FE\u63A5\u66F4\u65B0\u540E\uFF0C\u590D\u5236\u65B0\u94FE\u63A5\u5230\u540C\u4E00\u4E2A\u6D4F\u89C8\u5668\u7A97\u53E3\u7EE7\u7EED\u6388\u6743\uFF0C\u518D\u7C98\u8D34\u7B2C\u4E8C\u4E2A\u5B8C\u6574\u56DE\u8C03\u5730\u5740\u5E76\u63D0\u4EA4\u3002",
    async callback(_code, context = {}) {
      callbackSignal = context.signal;
      callbackSignal?.addEventListener("abort", abort, { once: true });
      if (callbackSignal?.aborted)
        abort();
      try {
        return await result;
      } finally {
        callbackSignal?.removeEventListener("abort", abort);
      }
    }
  };
}
function createAuthMethods(clientOptions = defaultOptions, wizardAvailable = false) {
  return [
    { type: "oauth", label: "Amazon Quick \u4E2A\u4EBA\u8D26\u53F7", authorize: (_inputs, context) => signIn("social", clientOptions, context, wizardAvailable) },
    { type: "oauth", label: "Amazon Quick \u4F01\u4E1A\u8D26\u53F7", authorize: (_inputs, context) => signIn("enterprise", clientOptions, context, wizardAvailable) }
  ];
}

// src/chat.js
import { randomUUID as randomUUID3 } from "crypto";

// src/messages.js
import { randomUUID } from "crypto";
function badRequest(message) {
  throw Object.assign(new Error(message), { status: 400, expose: true });
}
function textContent(content) {
  if (content == null)
    return "";
  if (typeof content === "string")
    return content;
  if (!Array.isArray(content))
    badRequest("Amazon Quick accepts text content only.");
  return content.map((part) => {
    if (typeof part === "string")
      return part;
    if (["text", "input_text", "output_text"].includes(part?.type) && typeof part.text === "string")
      return part.text;
    badRequest("Amazon Quick accepts text content only.");
  }).join("");
}
function toolSettings(body) {
  const declared = body.tools ?? [];
  const functions = body.functions ?? [];
  if (!Array.isArray(declared) || !Array.isArray(functions))
    badRequest("Invalid tool definitions.");
  const definitions = new Map;
  for (const item of [...declared, ...functions.map((fn) => ({ type: "function", function: fn }))]) {
    const fn = item?.function;
    if (item?.type !== "function" || typeof fn?.name !== "string" || !fn.name.trim()) {
      badRequest("Amazon Quick supports named function tools only.");
    }
    definitions.set(fn.name, { name: fn.name, description: fn.description, parameters: fn.parameters });
  }
  const choice = body.tool_choice ?? body.function_call ?? "auto";
  let required = false;
  if (choice === "none")
    definitions.clear();
  else if (choice === "required")
    required = true;
  else if (choice !== "auto") {
    const name = choice?.function?.name ?? choice?.name;
    if (!definitions.has(name) || choice.type && choice.type !== "function")
      badRequest("tool_choice must name a declared function.");
    const selected = definitions.get(name);
    definitions.clear();
    definitions.set(name, selected);
    required = true;
  }
  if (required && !definitions.size)
    badRequest("A required tool must be declared.");
  if (body.parallel_tool_calls != null && typeof body.parallel_tool_calls !== "boolean")
    badRequest("parallel_tool_calls must be a boolean.");
  return { enabled: definitions.size > 0, allowed: definitions, parallel: body.parallel_tool_calls !== false, required };
}
function toolInstructions(tools) {
  const names = [...tools.allowed.keys()];
  return [
    "The caller can execute the following functions:",
    JSON.stringify([...tools.allowed.values()]),
    "These client functions are available through a text bridge. For a native function call, emit one marker per call; the bridge converts it to the caller\u2019s tool_calls field.",
    '<client_tool_call>{"name":' + JSON.stringify(names.length === 1 ? names[0] : "FUNCTION_NAME") + ',"arguments":{}}</client_tool_call>',
    "Use the actual arguments from the task, following the declared parameter schema. Output the marker alone and wait for the caller to return the result.",
    tools.required && (names.length === 1 ? "You must call " + JSON.stringify(names[0]) + " this turn." : "You must call at least one listed function this turn."),
    !tools.parallel && "Call at most one function in this turn."
  ].filter(Boolean).join(`
`);
}
function prepareTurn(body) {
  if (!Array.isArray(body?.messages) || !body.messages.length)
    badRequest("messages must be a non-empty array.");
  const tools = toolSettings(body);
  const system = [], history = [], names = new Map;
  let lastUser = "";
  for (const message of body.messages) {
    if (!message || typeof message.role !== "string")
      badRequest("Each message must have a role.");
    if (message.audio != null)
      badRequest("Amazon Quick accepts text content only.");
    const text = textContent(message.content);
    switch (message.role) {
      case "system":
      case "developer":
        if (text)
          system.push(text);
        break;
      case "user":
        if (text.trim()) {
          lastUser = text;
          history.push(["User", text]);
        }
        break;
      case "assistant": {
        if (text)
          history.push(["Assistant", text]);
        const calls = message.tool_calls ?? [];
        if (!Array.isArray(calls))
          badRequest("Invalid assistant tool-call history.");
        for (const call of [...calls, ...message.function_call ? [{ function: message.function_call }] : []]) {
          const fn = call?.function;
          if (!fn || typeof fn.name !== "string")
            badRequest("Invalid assistant tool-call history.");
          if (call.id)
            names.set(call.id, fn.name);
          history.push(["Assistant tool call", JSON.stringify({ id: call.id, name: fn.name, arguments: fn.arguments ?? "{}" })]);
        }
        break;
      }
      case "tool":
      case "function":
        history.push(["Tool result", JSON.stringify({ id: message.tool_call_id, name: message.name ?? names.get(message.tool_call_id), content: text })]);
        break;
      default:
        badRequest("Unsupported message role.");
    }
  }
  if (!history.length)
    badRequest("messages contain no user text, assistant text, or tool history.");
  let prompt = history.length === 1 && history[0][0] === "User" ? history[0][1] : history.map(([label, text]) => label + ": " + text).join(`

`);
  if (tools.enabled) {
    const protocol = toolInstructions(tools);
    if (tools.required) {
      system.push("Return a client function call for this turn. Follow the wire format in the message for: " + JSON.stringify([...tools.allowed.keys()]) + ".");
      prompt += `

` + protocol;
    } else {
      system.push(protocol);
    }
  }
  const title = Array.from(lastUser.trim().replace(/\s+/g, " ")).slice(0, 64).join("") || "Magpie";
  return { prompt, systemPrompt: system.join(`

`), model: body.model, title, tools };
}
function asCall(item, tools) {
  const fn = item?.function ?? item;
  if (!fn || !tools.allowed.has(fn.name))
    return null;
  if (item.function && item.type != null && item.type !== "function")
    return null;
  let args = fn.arguments;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args || "{}");
    } catch {
      return null;
    }
  }
  if (args === undefined)
    args = {};
  if (!args || typeof args !== "object" || Array.isArray(args))
    return null;
  return {
    id: typeof item.id === "string" && item.id ? item.id : "call_" + randomUUID().replaceAll("-", ""),
    type: "function",
    function: { name: fn.name, arguments: JSON.stringify(args) }
  };
}
function parseCalls(json, tools, requireArguments = false) {
  let payload;
  try {
    payload = JSON.parse(json);
  } catch {
    return null;
  }
  const items = Array.isArray(payload) ? payload : Array.isArray(payload?.tool_calls) ? payload.tool_calls : [payload];
  if (requireArguments && items.some((item) => (item?.function ?? item)?.arguments === undefined))
    return null;
  const calls = items.map((item) => asCall(item, tools));
  return calls.length && calls.every(Boolean) ? calls : null;
}
function finishTools(text, nativeEvents, tools) {
  if (!tools.enabled)
    return { text, toolCalls: [] };
  const toolCalls = [];
  let cleaned = text.replace(/<client_tool_call>([\s\S]*?)<\/client_tool_call>/g, (marker, payload) => {
    const calls = parseCalls(payload, tools);
    if (!calls)
      return marker;
    toolCalls.push(...calls);
    return "";
  });
  if (!toolCalls.length) {
    for (const event of nativeEvents) {
      const call = asCall(event, tools);
      if (call)
        toolCalls.push(call);
    }
  }
  if (tools.required && !toolCalls.length) {
    const whole = text.trim();
    const fence = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(whole);
    const calls = parseCalls(fence ? fence[1] : whole, tools, true);
    if (!calls)
      throw Object.assign(new Error("Amazon Quick did not return a required tool call."), { status: 502, expose: true });
    toolCalls.push(...calls);
    cleaned = "";
  }
  return { text: cleaned === text ? text : cleaned.trim(), toolCalls: tools.parallel ? toolCalls : toolCalls.slice(0, 1) };
}

// src/transport.js
import { randomUUID as randomUUID2 } from "crypto";
import { EventEmitter, on } from "events";
import WebSocket from "ws";

// node_modules/cborg/lib/is.js
var objectTypeNames = [
  "Object",
  "Uint8Array",
  "RegExp",
  "Date",
  "Error",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "ArrayBuffer",
  "SharedArrayBuffer",
  "DataView",
  "Promise",
  "URL",
  "HTMLElement",
  "Int8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "Tagged",
  "Number",
  "String",
  "Boolean",
  "BigInt",
  "Symbol"
];
function is(value) {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (value === true || value === false) {
    return "boolean";
  }
  const typeOf = typeof value;
  if (typeOf === "string" || typeOf === "number" || typeOf === "bigint" || typeOf === "symbol") {
    return typeOf;
  }
  if (typeOf === "function") {
    return "Function";
  }
  if (Array.isArray(value)) {
    return "Array";
  }
  if (value instanceof Uint8Array) {
    return "Uint8Array";
  }
  if (value.constructor === Object) {
    return "Object";
  }
  const objectType = getObjectType(value);
  if (objectType) {
    return objectType;
  }
  return "Object";
}
function getObjectType(value) {
  const objectTypeName = Object.prototype.toString.call(value).slice(8, -1);
  if (objectTypeNames.includes(objectTypeName)) {
    return objectTypeName;
  }
  return;
}

// node_modules/cborg/lib/token.js
class Type {
  constructor(major, name, terminal) {
    this.major = major;
    this.majorEncoded = major << 5;
    this.name = name;
    this.terminal = terminal;
  }
  toString() {
    return `Type[${this.major}].${this.name}`;
  }
  compare(typ) {
    return this.major < typ.major ? -1 : this.major > typ.major ? 1 : 0;
  }
  static equals(a, b) {
    return a === b || a.major === b.major && a.name === b.name;
  }
}
Type.uint = new Type(0, "uint", true);
Type.negint = new Type(1, "negint", true);
Type.bytes = new Type(2, "bytes", true);
Type.string = new Type(3, "string", true);
Type.array = new Type(4, "array", false);
Type.map = new Type(5, "map", false);
Type.tag = new Type(6, "tag", false);
Type.float = new Type(7, "float", true);
Type.false = new Type(7, "false", true);
Type.true = new Type(7, "true", true);
Type.null = new Type(7, "null", true);
Type.undefined = new Type(7, "undefined", true);
Type.break = new Type(7, "break", true);

class Token {
  constructor(type, value, encodedLength) {
    this.type = type;
    this.value = value;
    this.encodedLength = encodedLength;
    this.encodedBytes = undefined;
    this.byteValue = undefined;
  }
  toString() {
    return `Token[${this.type}].${this.value}`;
  }
}

// node_modules/cborg/lib/writer.js
var FLAT_INIT = 2048;
var FLAT_LIMIT = 262144;
var FLAT_LARGE = 1024;
var FLAT_RETAIN = 65536;

class FlatWriter {
  constructor() {
    this.home = new Uint8Array(FLAT_INIT);
    this.buf = this.home;
    this.pos = 0;
    this.start = 0;
    this.segs = [];
    this.segLen = 0;
  }
  reset() {
    if (this.buf.length > this.home.length && this.buf.length <= FLAT_RETAIN) {
      this.home = this.buf;
    }
    this.buf = this.home;
    this.pos = 0;
    this.start = 0;
    if (this.segs.length > 0) {
      this.segs = [];
      this.segLen = 0;
    }
  }
  grow(need) {
    const open = this.pos - this.start;
    if (this.buf.length >= FLAT_LIMIT) {
      if (open > 0) {
        this.segs.push(this.buf.subarray(this.start, this.pos));
        this.segLen += open;
      }
      this.buf = new Uint8Array(need > FLAT_LIMIT ? need : FLAT_LIMIT);
      this.pos = 0;
      this.start = 0;
    } else {
      let size = this.buf.length * 2;
      while (size < open + need)
        size *= 2;
      const nb = new Uint8Array(size);
      nb.set(this.buf.subarray(this.start, this.pos));
      this.buf = nb;
      this.pos = open;
      this.start = 0;
    }
  }
  pushByte(byte) {
    if (this.pos >= this.buf.length)
      this.grow(1);
    this.buf[this.pos++] = byte;
  }
  pushArr(arr) {
    const n = arr.length;
    if (this.pos + n > this.buf.length)
      this.grow(n);
    const b = this.buf;
    let c = this.pos;
    for (let i = 0;i < n; i++)
      b[c++] = arr[i];
    this.pos = c;
  }
  pushBytes(bytes) {
    const n = bytes.length;
    if (n >= FLAT_LARGE) {
      if (this.pos > this.start) {
        this.segs.push(this.buf.subarray(this.start, this.pos));
        this.segLen += this.pos - this.start;
      }
      this.segs.push(bytes);
      this.segLen += n;
      this.start = this.pos;
      return;
    }
    if (this.pos + n > this.buf.length)
      this.grow(n);
    const b = this.buf;
    let c = this.pos;
    if (n < 16) {
      for (let i = 0;i < n; i++)
        b[c++] = bytes[i];
    } else {
      b.set(bytes, c);
      c += n;
    }
    this.pos = c;
  }
  push(bytes) {
    if (Array.isArray(bytes))
      this.pushArr(bytes);
    else
      this.pushBytes(bytes);
  }
  toBytes(reset = false) {
    let out;
    if (this.segs.length === 0) {
      out = new Uint8Array(this.buf.subarray(this.start, this.pos));
    } else {
      out = new Uint8Array(this.segLen + (this.pos - this.start));
      let off = 0;
      for (const seg of this.segs) {
        out.set(seg, off);
        off += seg.length;
      }
      out.set(this.buf.subarray(this.start, this.pos), off);
    }
    if (reset)
      this.reset();
    return out;
  }
}

class U8Writer {
  constructor(dest) {
    this.dest = dest;
    this.cursor = 0;
  }
  reset() {
    this.cursor = 0;
  }
  pushByte(byte) {
    if (this.cursor >= this.dest.length) {
      throw new Error("write out of bounds, destination buffer is too small");
    }
    this.dest[this.cursor++] = byte;
  }
  push(bytes) {
    if (this.cursor + bytes.length > this.dest.length) {
      throw new Error("write out of bounds, destination buffer is too small");
    }
    this.dest.set(bytes, this.cursor);
    this.cursor += bytes.length;
  }
  pushArr(bytes) {
    const n = bytes.length;
    if (this.cursor + n > this.dest.length) {
      throw new Error("write out of bounds, destination buffer is too small");
    }
    const dest = this.dest;
    let c = this.cursor;
    for (let i = 0;i < n; i++)
      dest[c++] = bytes[i];
    this.cursor = c;
  }
  pushBytes(bytes) {
    this.push(bytes);
  }
  toBytes(reset = false) {
    const byts = this.dest.subarray(0, this.cursor);
    if (reset) {
      this.reset();
    }
    return byts;
  }
}

// node_modules/cborg/lib/common.js
var decodeErrPrefix = "CBOR decode error:";
var encodeErrPrefix = "CBOR encode error:";
var uintMinorPrefixBytes = [];
uintMinorPrefixBytes[23] = 1;
uintMinorPrefixBytes[24] = 2;
uintMinorPrefixBytes[25] = 3;
uintMinorPrefixBytes[26] = 5;
uintMinorPrefixBytes[27] = 9;
function assertEnoughData(data, pos, need) {
  if (data.length - pos < need) {
    throw new Error(`${decodeErrPrefix} not enough data for type`);
  }
}

// node_modules/cborg/lib/0uint.js
var uintBoundaries = [24, 256, 65536, 4294967296, BigInt("18446744073709551616")];
function readUint8(data, offset, options) {
  assertEnoughData(data, offset, 1);
  const value = data[offset];
  if (options.strict === true && value < uintBoundaries[0]) {
    throw new Error(`${decodeErrPrefix} integer encoded in more bytes than necessary (strict decode)`);
  }
  return value;
}
function readUint16(data, offset, options) {
  assertEnoughData(data, offset, 2);
  const value = data[offset] << 8 | data[offset + 1];
  if (options.strict === true && value < uintBoundaries[1]) {
    throw new Error(`${decodeErrPrefix} integer encoded in more bytes than necessary (strict decode)`);
  }
  return value;
}
function readUint32(data, offset, options) {
  assertEnoughData(data, offset, 4);
  const value = data[offset] * 16777216 + (data[offset + 1] << 16) + (data[offset + 2] << 8) + data[offset + 3];
  if (options.strict === true && value < uintBoundaries[2]) {
    throw new Error(`${decodeErrPrefix} integer encoded in more bytes than necessary (strict decode)`);
  }
  return value;
}
function readUint64(data, offset, options) {
  assertEnoughData(data, offset, 8);
  const hi = data[offset] * 16777216 + (data[offset + 1] << 16) + (data[offset + 2] << 8) + data[offset + 3];
  const lo = data[offset + 4] * 16777216 + (data[offset + 5] << 16) + (data[offset + 6] << 8) + data[offset + 7];
  const value = (BigInt(hi) << BigInt(32)) + BigInt(lo);
  if (options.strict === true && value < uintBoundaries[3]) {
    throw new Error(`${decodeErrPrefix} integer encoded in more bytes than necessary (strict decode)`);
  }
  if (value <= Number.MAX_SAFE_INTEGER) {
    return Number(value);
  }
  if (options.allowBigInt === true) {
    return value;
  }
  throw new Error(`${decodeErrPrefix} integers outside of the safe integer range are not supported`);
}
function decodeUint8(data, pos, _minor, options) {
  return new Token(Type.uint, readUint8(data, pos + 1, options), 2);
}
function decodeUint16(data, pos, _minor, options) {
  return new Token(Type.uint, readUint16(data, pos + 1, options), 3);
}
function decodeUint32(data, pos, _minor, options) {
  return new Token(Type.uint, readUint32(data, pos + 1, options), 5);
}
function decodeUint64(data, pos, _minor, options) {
  return new Token(Type.uint, readUint64(data, pos + 1, options), 9);
}
function encodeUint(writer, token) {
  return encodeUintValue(writer, 0, token.value);
}
function encodeUintValue(writer, major, uint) {
  if (uint < uintBoundaries[0]) {
    const nuint = Number(uint);
    writer.pushByte(major | nuint);
  } else if (uint < uintBoundaries[1]) {
    const nuint = Number(uint);
    writer.pushArr([major | 24, nuint]);
  } else if (uint < uintBoundaries[2]) {
    const nuint = Number(uint);
    writer.pushArr([major | 25, nuint >>> 8, nuint & 255]);
  } else if (uint < uintBoundaries[3]) {
    const nuint = Number(uint);
    writer.pushArr([major | 26, nuint >>> 24 & 255, nuint >>> 16 & 255, nuint >>> 8 & 255, nuint & 255]);
  } else {
    const buint = BigInt(uint);
    if (buint < uintBoundaries[4]) {
      const set = [major | 27, 0, 0, 0, 0, 0, 0, 0];
      let lo = Number(buint & BigInt(4294967295));
      let hi = Number(buint >> BigInt(32) & BigInt(4294967295));
      set[8] = lo & 255;
      lo = lo >> 8;
      set[7] = lo & 255;
      lo = lo >> 8;
      set[6] = lo & 255;
      lo = lo >> 8;
      set[5] = lo & 255;
      set[4] = hi & 255;
      hi = hi >> 8;
      set[3] = hi & 255;
      hi = hi >> 8;
      set[2] = hi & 255;
      hi = hi >> 8;
      set[1] = hi & 255;
      writer.pushArr(set);
    } else {
      throw new Error(`${encodeErrPrefix} encountered BigInt larger than allowable range`);
    }
  }
}
encodeUint.encodedSize = function encodedSize(token) {
  return encodeUintValue.encodedSize(token.value);
};
encodeUintValue.encodedSize = function encodedSize(uint) {
  if (uint < uintBoundaries[0]) {
    return 1;
  }
  if (uint < uintBoundaries[1]) {
    return 2;
  }
  if (uint < uintBoundaries[2]) {
    return 3;
  }
  if (uint < uintBoundaries[3]) {
    return 5;
  }
  if (uint >= uintBoundaries[4]) {
    throw new Error(`${encodeErrPrefix} encountered BigInt larger than allowable range`);
  }
  return 9;
};
encodeUint.compareTokens = function compareTokens(tok1, tok2) {
  return tok1.value < tok2.value ? -1 : tok1.value > tok2.value ? 1 : 0;
};

// node_modules/cborg/lib/1negint.js
function decodeNegint8(data, pos, _minor, options) {
  return new Token(Type.negint, -1 - readUint8(data, pos + 1, options), 2);
}
function decodeNegint16(data, pos, _minor, options) {
  return new Token(Type.negint, -1 - readUint16(data, pos + 1, options), 3);
}
function decodeNegint32(data, pos, _minor, options) {
  return new Token(Type.negint, -1 - readUint32(data, pos + 1, options), 5);
}
var neg1b = BigInt(-1);
var pos1b = BigInt(1);
function decodeNegint64(data, pos, _minor, options) {
  const int = readUint64(data, pos + 1, options);
  if (typeof int !== "bigint") {
    const value = -1 - int;
    if (value >= Number.MIN_SAFE_INTEGER) {
      return new Token(Type.negint, value, 9);
    }
  }
  if (options.allowBigInt !== true) {
    throw new Error(`${decodeErrPrefix} integers outside of the safe integer range are not supported`);
  }
  return new Token(Type.negint, neg1b - BigInt(int), 9);
}
function encodeNegint(writer, token) {
  const negint = token.value;
  const unsigned = typeof negint === "bigint" ? negint * neg1b - pos1b : negint * -1 - 1;
  encodeUintValue(writer, token.type.majorEncoded, unsigned);
}
encodeNegint.encodedSize = function encodedSize(token) {
  const negint = token.value;
  const unsigned = typeof negint === "bigint" ? negint * neg1b - pos1b : negint * -1 - 1;
  if (unsigned < uintBoundaries[0]) {
    return 1;
  }
  if (unsigned < uintBoundaries[1]) {
    return 2;
  }
  if (unsigned < uintBoundaries[2]) {
    return 3;
  }
  if (unsigned < uintBoundaries[3]) {
    return 5;
  }
  if (unsigned >= uintBoundaries[4]) {
    throw new Error(`${encodeErrPrefix} encountered BigInt larger than allowable range`);
  }
  return 9;
};
encodeNegint.compareTokens = function compareTokens(tok1, tok2) {
  return tok1.value < tok2.value ? 1 : tok1.value > tok2.value ? -1 : 0;
};

// node_modules/cborg/lib/byte-utils.js
var useBuffer = globalThis.process && !globalThis.process.browser && globalThis.Buffer && typeof globalThis.Buffer.isBuffer === "function";
var textEncoder = new TextEncoder;
function isBuffer(buf) {
  return useBuffer && globalThis.Buffer.isBuffer(buf);
}
function asU8A(buf) {
  if (!(buf instanceof Uint8Array)) {
    return Uint8Array.from(buf);
  }
  return isBuffer(buf) ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : buf;
}
var FROM_STRING_THRESHOLD_BUFFER = 24;
var FROM_STRING_THRESHOLD_TEXTENCODER = 200;
var fromString = useBuffer ? (string) => {
  return string.length >= FROM_STRING_THRESHOLD_BUFFER ? globalThis.Buffer.from(string) : utf8ToBytes(string);
} : (string) => {
  return string.length >= FROM_STRING_THRESHOLD_TEXTENCODER ? textEncoder.encode(string) : utf8ToBytes(string);
};
var fromArray = (arr) => {
  return Uint8Array.from(arr);
};
function compare(b1, b2) {
  if (isBuffer(b1) && isBuffer(b2)) {
    return b1.compare(b2);
  }
  for (let i = 0;i < b1.length; i++) {
    if (b1[i] === b2[i]) {
      continue;
    }
    return b1[i] < b2[i] ? -1 : 1;
  }
  return 0;
}
function utf8ToBytes(str) {
  const out = [];
  let p = 0;
  for (let i = 0;i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 128) {
      out[p++] = c;
    } else if (c < 2048) {
      out[p++] = c >> 6 | 192;
      out[p++] = c & 63 | 128;
    } else if ((c & 64512) === 55296 && i + 1 < str.length && (str.charCodeAt(i + 1) & 64512) === 56320) {
      c = 65536 + ((c & 1023) << 10) + (str.charCodeAt(++i) & 1023);
      out[p++] = c >> 18 | 240;
      out[p++] = c >> 12 & 63 | 128;
      out[p++] = c >> 6 & 63 | 128;
      out[p++] = c & 63 | 128;
    } else {
      if (c >= 55296 && c <= 57343) {
        c = 65533;
      }
      out[p++] = c >> 12 | 224;
      out[p++] = c >> 6 & 63 | 128;
      out[p++] = c & 63 | 128;
    }
  }
  return out;
}

// node_modules/cborg/lib/2bytes.js
function toToken(data, pos, prefix, length) {
  assertEnoughData(data, pos, prefix + length);
  const buf = data.slice(pos + prefix, pos + prefix + length);
  return new Token(Type.bytes, buf, prefix + length);
}
function decodeBytesCompact(data, pos, minor, _options) {
  return toToken(data, pos, 1, minor);
}
function decodeBytes8(data, pos, _minor, options) {
  return toToken(data, pos, 2, readUint8(data, pos + 1, options));
}
function decodeBytes16(data, pos, _minor, options) {
  return toToken(data, pos, 3, readUint16(data, pos + 1, options));
}
function decodeBytes32(data, pos, _minor, options) {
  return toToken(data, pos, 5, readUint32(data, pos + 1, options));
}
function decodeBytes64(data, pos, _minor, options) {
  const l = readUint64(data, pos + 1, options);
  if (typeof l === "bigint") {
    throw new Error(`${decodeErrPrefix} 64-bit integer bytes lengths not supported`);
  }
  return toToken(data, pos, 9, l);
}
function tokenBytes(token) {
  if (token.encodedBytes === undefined) {
    token.encodedBytes = Type.equals(token.type, Type.string) ? fromString(token.value) : token.value;
  }
  return token.encodedBytes;
}
function encodeBytes(writer, token) {
  const bytes = tokenBytes(token);
  encodeUintValue(writer, token.type.majorEncoded, bytes.length);
  writer.push(bytes);
}
encodeBytes.encodedSize = function encodedSize(token) {
  const bytes = tokenBytes(token);
  return encodeUintValue.encodedSize(bytes.length) + bytes.length;
};
encodeBytes.compareTokens = function compareTokens(tok1, tok2) {
  return compareBytes(tokenBytes(tok1), tokenBytes(tok2));
};
function compareBytes(b1, b2) {
  return b1.length < b2.length ? -1 : b1.length > b2.length ? 1 : compare(b1, b2);
}

// node_modules/cborg/lib/3string.js
var textDecoder = new TextDecoder("utf-8", { ignoreBOM: true });
var fatalDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
var ASCII_THRESHOLD = 32;
function toStr(bytes, start, end, options) {
  const len = end - start;
  if (len < ASCII_THRESHOLD) {
    let str = "";
    for (let i = start;i < end; i++) {
      const c = bytes[i];
      if (c & 128) {
        return options.rejectInvalidUtf8 === true ? decodeStrict(bytes, start, end) : textDecoder.decode(bytes.subarray(start, end));
      }
      str += String.fromCharCode(c);
    }
    return str;
  }
  return options.rejectInvalidUtf8 === true ? decodeStrict(bytes, start, end) : textDecoder.decode(bytes.subarray(start, end));
}
function decodeStrict(bytes, start, end) {
  try {
    return fatalDecoder.decode(bytes.subarray(start, end));
  } catch {
    throw new Error(`${decodeErrPrefix} invalid UTF-8 in text string`);
  }
}
function toToken2(data, pos, prefix, length, options) {
  const totLength = prefix + length;
  assertEnoughData(data, pos, totLength);
  const tok = new Token(Type.string, toStr(data, pos + prefix, pos + totLength, options), totLength);
  if (options.retainStringBytes === true) {
    tok.byteValue = data.slice(pos + prefix, pos + totLength);
  }
  return tok;
}
function decodeStringCompact(data, pos, minor, options) {
  return toToken2(data, pos, 1, minor, options);
}
function decodeString8(data, pos, _minor, options) {
  return toToken2(data, pos, 2, readUint8(data, pos + 1, options), options);
}
function decodeString16(data, pos, _minor, options) {
  return toToken2(data, pos, 3, readUint16(data, pos + 1, options), options);
}
function decodeString32(data, pos, _minor, options) {
  return toToken2(data, pos, 5, readUint32(data, pos + 1, options), options);
}
function decodeString64(data, pos, _minor, options) {
  const l = readUint64(data, pos + 1, options);
  if (typeof l === "bigint") {
    throw new Error(`${decodeErrPrefix} 64-bit integer string lengths not supported`);
  }
  return toToken2(data, pos, 9, l, options);
}
var encodeString = encodeBytes;

// node_modules/cborg/lib/4array.js
function toToken3(_data, _pos, prefix, length) {
  return new Token(Type.array, length, prefix);
}
function decodeArrayCompact(data, pos, minor, _options) {
  return toToken3(data, pos, 1, minor);
}
function decodeArray8(data, pos, _minor, options) {
  return toToken3(data, pos, 2, readUint8(data, pos + 1, options));
}
function decodeArray16(data, pos, _minor, options) {
  return toToken3(data, pos, 3, readUint16(data, pos + 1, options));
}
function decodeArray32(data, pos, _minor, options) {
  return toToken3(data, pos, 5, readUint32(data, pos + 1, options));
}
function decodeArray64(data, pos, _minor, options) {
  const l = readUint64(data, pos + 1, options);
  if (typeof l === "bigint") {
    throw new Error(`${decodeErrPrefix} 64-bit integer array lengths not supported`);
  }
  return toToken3(data, pos, 9, l);
}
function decodeArrayIndefinite(data, pos, _minor, options) {
  if (options.allowIndefinite === false) {
    throw new Error(`${decodeErrPrefix} indefinite length items not allowed`);
  }
  return toToken3(data, pos, 1, Infinity);
}
function encodeArray(writer, token) {
  encodeUintValue(writer, Type.array.majorEncoded, token.value);
}
encodeArray.compareTokens = encodeUint.compareTokens;
encodeArray.encodedSize = function encodedSize(token) {
  return encodeUintValue.encodedSize(token.value);
};

// node_modules/cborg/lib/5map.js
function toToken4(_data, _pos, prefix, length) {
  return new Token(Type.map, length, prefix);
}
function decodeMapCompact(data, pos, minor, _options) {
  return toToken4(data, pos, 1, minor);
}
function decodeMap8(data, pos, _minor, options) {
  return toToken4(data, pos, 2, readUint8(data, pos + 1, options));
}
function decodeMap16(data, pos, _minor, options) {
  return toToken4(data, pos, 3, readUint16(data, pos + 1, options));
}
function decodeMap32(data, pos, _minor, options) {
  return toToken4(data, pos, 5, readUint32(data, pos + 1, options));
}
function decodeMap64(data, pos, _minor, options) {
  const l = readUint64(data, pos + 1, options);
  if (typeof l === "bigint") {
    throw new Error(`${decodeErrPrefix} 64-bit integer map lengths not supported`);
  }
  return toToken4(data, pos, 9, l);
}
function decodeMapIndefinite(data, pos, _minor, options) {
  if (options.allowIndefinite === false) {
    throw new Error(`${decodeErrPrefix} indefinite length items not allowed`);
  }
  return toToken4(data, pos, 1, Infinity);
}
function encodeMap(writer, token) {
  encodeUintValue(writer, Type.map.majorEncoded, token.value);
}
encodeMap.compareTokens = encodeUint.compareTokens;
encodeMap.encodedSize = function encodedSize(token) {
  return encodeUintValue.encodedSize(token.value);
};

// node_modules/cborg/lib/6tag.js
function decodeTagCompact(_data, _pos, minor, _options) {
  return new Token(Type.tag, minor, 1);
}
function decodeTag8(data, pos, _minor, options) {
  return new Token(Type.tag, readUint8(data, pos + 1, options), 2);
}
function decodeTag16(data, pos, _minor, options) {
  return new Token(Type.tag, readUint16(data, pos + 1, options), 3);
}
function decodeTag32(data, pos, _minor, options) {
  return new Token(Type.tag, readUint32(data, pos + 1, options), 5);
}
function decodeTag64(data, pos, _minor, options) {
  return new Token(Type.tag, readUint64(data, pos + 1, options), 9);
}
function encodeTag(writer, token) {
  encodeUintValue(writer, Type.tag.majorEncoded, token.value);
}
encodeTag.compareTokens = encodeUint.compareTokens;
encodeTag.encodedSize = function encodedSize(token) {
  return encodeUintValue.encodedSize(token.value);
};

// node_modules/cborg/lib/7float.js
var MINOR_FALSE = 20;
var MINOR_TRUE = 21;
var MINOR_NULL = 22;
var MINOR_UNDEFINED = 23;
function decodeUndefined(_data, _pos, _minor, options) {
  if (options.allowUndefined === false) {
    throw new Error(`${decodeErrPrefix} undefined values are not supported`);
  } else if (options.coerceUndefinedToNull === true) {
    return new Token(Type.null, null, 1);
  }
  return new Token(Type.undefined, undefined, 1);
}
function decodeBreak(_data, _pos, _minor, options) {
  if (options.allowIndefinite === false) {
    throw new Error(`${decodeErrPrefix} indefinite length items not allowed`);
  }
  return new Token(Type.break, undefined, 1);
}
function createToken(value, bytes, options) {
  if (options) {
    if (options.allowNaN === false && Number.isNaN(value)) {
      throw new Error(`${decodeErrPrefix} NaN values are not supported`);
    }
    if (options.allowInfinity === false && (value === Infinity || value === -Infinity)) {
      throw new Error(`${decodeErrPrefix} Infinity values are not supported`);
    }
  }
  return new Token(Type.float, value, bytes);
}
function decodeFloat16(data, pos, _minor, options) {
  return createToken(readFloat16(data, pos + 1), 3, options);
}
function decodeFloat32(data, pos, _minor, options) {
  return createToken(readFloat32(data, pos + 1), 5, options);
}
function decodeFloat64(data, pos, _minor, options) {
  return createToken(readFloat64(data, pos + 1), 9, options);
}
function encodeFloat(writer, token, options) {
  const float = token.value;
  if (float === false) {
    writer.pushByte(Type.float.majorEncoded | MINOR_FALSE);
  } else if (float === true) {
    writer.pushByte(Type.float.majorEncoded | MINOR_TRUE);
  } else if (float === null) {
    writer.pushByte(Type.float.majorEncoded | MINOR_NULL);
  } else if (float === undefined) {
    if (!Type.equals(token.type, Type.break)) {
      writer.pushByte(Type.float.majorEncoded | MINOR_UNDEFINED);
    }
  } else {
    let decoded;
    let success = false;
    if (!options || options.float64 !== true) {
      encodeFloat16(float);
      decoded = readFloat16(ui8a, 1);
      if (float === decoded || Number.isNaN(float)) {
        ui8a[0] = 249;
        writer.pushBytes(ui8a.slice(0, 3));
        success = true;
      } else {
        encodeFloat32(float);
        decoded = readFloat32(ui8a, 1);
        if (float === decoded) {
          ui8a[0] = 250;
          writer.pushBytes(ui8a.slice(0, 5));
          success = true;
        }
      }
    }
    if (!success) {
      encodeFloat64(float);
      decoded = readFloat64(ui8a, 1);
      ui8a[0] = 251;
      writer.pushBytes(ui8a.slice(0, 9));
    }
  }
}
encodeFloat.encodedSize = function encodedSize(token, options) {
  const float = token.value;
  if (float === undefined) {
    return Type.equals(token.type, Type.break) ? 0 : 1;
  }
  if (float === false || float === true || float === null) {
    return 1;
  }
  if (!options || options.float64 !== true) {
    encodeFloat16(float);
    let decoded = readFloat16(ui8a, 1);
    if (float === decoded || Number.isNaN(float)) {
      return 3;
    }
    encodeFloat32(float);
    decoded = readFloat32(ui8a, 1);
    if (float === decoded) {
      return 5;
    }
  }
  return 9;
};
var buffer = new ArrayBuffer(9);
var dataView = new DataView(buffer, 1);
var ui8a = new Uint8Array(buffer, 0);
function encodeFloat16(inp) {
  if (inp === Infinity) {
    dataView.setUint16(0, 31744, false);
  } else if (inp === -Infinity) {
    dataView.setUint16(0, 64512, false);
  } else if (Number.isNaN(inp)) {
    dataView.setUint16(0, 32256, false);
  } else {
    dataView.setFloat32(0, inp);
    const valu32 = dataView.getUint32(0);
    const exponent = (valu32 & 2139095040) >> 23;
    const mantissa = valu32 & 8388607;
    if (exponent === 255) {
      dataView.setUint16(0, 31744, false);
    } else if (exponent === 0) {
      dataView.setUint16(0, (valu32 & 2147483648) >> 16 | mantissa >> 13, false);
    } else {
      const logicalExponent = exponent - 127;
      if (logicalExponent < -24) {
        dataView.setUint16(0, 0);
      } else if (logicalExponent < -14) {
        dataView.setUint16(0, (valu32 & 2147483648) >> 16 | (8388608 | mantissa) >> -1 - logicalExponent, false);
      } else {
        dataView.setUint16(0, (valu32 & 2147483648) >> 16 | logicalExponent + 15 << 10 | mantissa >> 13, false);
      }
    }
  }
}
function readFloat16(ui8a, pos) {
  if (ui8a.length - pos < 2) {
    throw new Error(`${decodeErrPrefix} not enough data for float16`);
  }
  const half = (ui8a[pos] << 8) + ui8a[pos + 1];
  if (half === 31744) {
    return Infinity;
  }
  if (half === 64512) {
    return -Infinity;
  }
  if (half === 32256) {
    return NaN;
  }
  const exp = half >> 10 & 31;
  const mant = half & 1023;
  let val;
  if (exp === 0) {
    val = mant * 2 ** -24;
  } else if (exp !== 31) {
    val = (mant + 1024) * 2 ** (exp - 25);
  } else {
    val = mant === 0 ? Infinity : NaN;
  }
  return half & 32768 ? -val : val;
}
function encodeFloat32(inp) {
  dataView.setFloat32(0, inp, false);
}
function readFloat32(ui8a, pos) {
  if (ui8a.length - pos < 4) {
    throw new Error(`${decodeErrPrefix} not enough data for float32`);
  }
  const offset = (ui8a.byteOffset || 0) + pos;
  return new DataView(ui8a.buffer, offset, 4).getFloat32(0, false);
}
function encodeFloat64(inp) {
  dataView.setFloat64(0, inp, false);
}
function readFloat64(ui8a, pos) {
  if (ui8a.length - pos < 8) {
    throw new Error(`${decodeErrPrefix} not enough data for float64`);
  }
  const offset = (ui8a.byteOffset || 0) + pos;
  return new DataView(ui8a.buffer, offset, 8).getFloat64(0, false);
}
function encodeMajorSevenBytes(token, float64) {
  const float = token.value;
  if (float === false) {
    return Uint8Array.of(Type.float.majorEncoded | MINOR_FALSE);
  }
  if (float === true) {
    return Uint8Array.of(Type.float.majorEncoded | MINOR_TRUE);
  }
  if (float === null) {
    return Uint8Array.of(Type.float.majorEncoded | MINOR_NULL);
  }
  if (float === undefined) {
    return Uint8Array.of(Type.float.majorEncoded | MINOR_UNDEFINED);
  }
  if (!float64) {
    encodeFloat16(float);
    if (float === readFloat16(ui8a, 1) || Number.isNaN(float)) {
      ui8a[0] = 249;
      return ui8a.slice(0, 3);
    }
    encodeFloat32(float);
    if (float === readFloat32(ui8a, 1)) {
      ui8a[0] = 250;
      return ui8a.slice(0, 5);
    }
  }
  encodeFloat64(float);
  ui8a[0] = 251;
  return ui8a.slice(0, 9);
}
function majorSevenBytes(token, options) {
  const tokenEx = token;
  const float64 = options?.float64 === true;
  const cached = float64 ? tokenEx._keyBytesFloat64 : tokenEx._keyBytes;
  if (cached !== undefined) {
    return cached;
  }
  const bytes = encodeMajorSevenBytes(token, float64);
  if (float64) {
    tokenEx._keyBytesFloat64 = bytes;
  } else {
    tokenEx._keyBytes = bytes;
  }
  return bytes;
}
encodeFloat.compareTokens = function compareTokens(tok1, tok2, options) {
  const b1 = majorSevenBytes(tok1, options);
  const b2 = majorSevenBytes(tok2, options);
  if (b1.length !== b2.length) {
    return b1.length < b2.length ? -1 : 1;
  }
  return compare(b1, b2);
};

// node_modules/cborg/lib/jump.js
function invalidMinor(data, pos, minor) {
  throw new Error(`${decodeErrPrefix} encountered invalid minor (${minor}) for major ${data[pos] >>> 5}`);
}
function errorer(msg) {
  return () => {
    throw new Error(`${decodeErrPrefix} ${msg}`);
  };
}
var jump = [];
for (let i = 0;i <= 23; i++) {
  jump[i] = invalidMinor;
}
jump[24] = decodeUint8;
jump[25] = decodeUint16;
jump[26] = decodeUint32;
jump[27] = decodeUint64;
jump[28] = invalidMinor;
jump[29] = invalidMinor;
jump[30] = invalidMinor;
jump[31] = invalidMinor;
for (let i = 32;i <= 55; i++) {
  jump[i] = invalidMinor;
}
jump[56] = decodeNegint8;
jump[57] = decodeNegint16;
jump[58] = decodeNegint32;
jump[59] = decodeNegint64;
jump[60] = invalidMinor;
jump[61] = invalidMinor;
jump[62] = invalidMinor;
jump[63] = invalidMinor;
for (let i = 64;i <= 87; i++) {
  jump[i] = decodeBytesCompact;
}
jump[88] = decodeBytes8;
jump[89] = decodeBytes16;
jump[90] = decodeBytes32;
jump[91] = decodeBytes64;
jump[92] = invalidMinor;
jump[93] = invalidMinor;
jump[94] = invalidMinor;
jump[95] = errorer("indefinite length bytes/strings are not supported");
for (let i = 96;i <= 119; i++) {
  jump[i] = decodeStringCompact;
}
jump[120] = decodeString8;
jump[121] = decodeString16;
jump[122] = decodeString32;
jump[123] = decodeString64;
jump[124] = invalidMinor;
jump[125] = invalidMinor;
jump[126] = invalidMinor;
jump[127] = errorer("indefinite length bytes/strings are not supported");
for (let i = 128;i <= 151; i++) {
  jump[i] = decodeArrayCompact;
}
jump[152] = decodeArray8;
jump[153] = decodeArray16;
jump[154] = decodeArray32;
jump[155] = decodeArray64;
jump[156] = invalidMinor;
jump[157] = invalidMinor;
jump[158] = invalidMinor;
jump[159] = decodeArrayIndefinite;
for (let i = 160;i <= 183; i++) {
  jump[i] = decodeMapCompact;
}
jump[184] = decodeMap8;
jump[185] = decodeMap16;
jump[186] = decodeMap32;
jump[187] = decodeMap64;
jump[188] = invalidMinor;
jump[189] = invalidMinor;
jump[190] = invalidMinor;
jump[191] = decodeMapIndefinite;
for (let i = 192;i <= 215; i++) {
  jump[i] = decodeTagCompact;
}
jump[216] = decodeTag8;
jump[217] = decodeTag16;
jump[218] = decodeTag32;
jump[219] = decodeTag64;
jump[220] = invalidMinor;
jump[221] = invalidMinor;
jump[222] = invalidMinor;
jump[223] = invalidMinor;
for (let i = 224;i <= 243; i++) {
  jump[i] = errorer("simple values are not supported");
}
jump[244] = invalidMinor;
jump[245] = invalidMinor;
jump[246] = invalidMinor;
jump[247] = decodeUndefined;
jump[248] = errorer("simple values are not supported");
jump[249] = decodeFloat16;
jump[250] = decodeFloat32;
jump[251] = decodeFloat64;
jump[252] = invalidMinor;
jump[253] = invalidMinor;
jump[254] = invalidMinor;
jump[255] = decodeBreak;
var quick = [];
for (let i = 0;i < 24; i++) {
  quick[i] = new Token(Type.uint, i, 1);
}
for (let i = -1;i >= -24; i--) {
  quick[31 - i] = new Token(Type.negint, i, 1);
}
quick[64] = new Token(Type.bytes, new Uint8Array(0), 1);
quick[96] = new Token(Type.string, "", 1);
quick[128] = new Token(Type.array, 0, 1);
quick[160] = new Token(Type.map, 0, 1);
quick[244] = new Token(Type.false, false, 1);
quick[245] = new Token(Type.true, true, 1);
quick[246] = new Token(Type.null, null, 1);
function quickEncodeToken(token) {
  switch (token.type) {
    case Type.false:
      return fromArray([244]);
    case Type.true:
      return fromArray([245]);
    case Type.null:
      return fromArray([246]);
    case Type.bytes:
      if (!token.value.length) {
        return fromArray([64]);
      }
      return;
    case Type.string:
      if (token.value === "") {
        return fromArray([96]);
      }
      return;
    case Type.array:
      if (token.value === 0) {
        return fromArray([128]);
      }
      return;
    case Type.map:
      if (token.value === 0) {
        return fromArray([160]);
      }
      return;
    case Type.uint:
      if (token.value < 24) {
        return fromArray([Number(token.value)]);
      }
      return;
    case Type.negint:
      if (token.value >= -24) {
        return fromArray([31 - Number(token.value)]);
      }
  }
}

// node_modules/cborg/lib/encode.js
var defaultEncodeOptions = {
  float64: false,
  mapSorter,
  quickEncodeToken
};
var rfc8949EncodeOptions = Object.freeze({
  mapSorter: rfc8949MapSorter,
  quickEncodeToken
});
function makeCborEncoders() {
  const encoders = [];
  encoders[Type.uint.major] = encodeUint;
  encoders[Type.negint.major] = encodeNegint;
  encoders[Type.bytes.major] = encodeBytes;
  encoders[Type.string.major] = encodeString;
  encoders[Type.array.major] = encodeArray;
  encoders[Type.map.major] = encodeMap;
  encoders[Type.tag.major] = encodeTag;
  encoders[Type.float.major] = encodeFloat;
  return encoders;
}
var cborEncoders = makeCborEncoders();
var defaultWriter = new FlatWriter;
var defaultWriterBusy = false;

class Ref {
  constructor(obj, parent) {
    this.obj = obj;
    this.parent = parent;
  }
  includes(obj) {
    let p = this;
    do {
      if (p.obj === obj) {
        return true;
      }
    } while (p = p.parent);
    return false;
  }
  static createCheck(stack, obj) {
    if (stack && stack.includes(obj)) {
      throw new Error(`${encodeErrPrefix} object contains circular references`);
    }
    return new Ref(obj, stack);
  }
}
var simpleTokens = {
  null: new Token(Type.null, null),
  undefined: new Token(Type.undefined, undefined),
  true: new Token(Type.true, true),
  false: new Token(Type.false, false),
  emptyArray: new Token(Type.array, 0),
  emptyMap: new Token(Type.map, 0)
};
var typeEncoders = {
  number(obj, _typ, _options, _refStack) {
    if (!Number.isInteger(obj) || !Number.isSafeInteger(obj)) {
      return new Token(Type.float, obj);
    } else if (obj >= 0) {
      return new Token(Type.uint, obj);
    } else {
      return new Token(Type.negint, obj);
    }
  },
  bigint(obj, _typ, _options, _refStack) {
    if (obj >= BigInt(0)) {
      return new Token(Type.uint, obj);
    } else {
      return new Token(Type.negint, obj);
    }
  },
  Uint8Array(obj, _typ, _options, _refStack) {
    return new Token(Type.bytes, obj);
  },
  string(obj, _typ, _options, _refStack) {
    return new Token(Type.string, obj);
  },
  boolean(obj, _typ, _options, _refStack) {
    return obj ? simpleTokens.true : simpleTokens.false;
  },
  null(_obj, _typ, _options, _refStack) {
    return simpleTokens.null;
  },
  undefined(_obj, _typ, _options, _refStack) {
    return simpleTokens.undefined;
  },
  ArrayBuffer(obj, _typ, _options, _refStack) {
    return new Token(Type.bytes, new Uint8Array(obj));
  },
  DataView(obj, _typ, _options, _refStack) {
    return new Token(Type.bytes, new Uint8Array(obj.buffer, obj.byteOffset, obj.byteLength));
  },
  Array(obj, _typ, options, refStack) {
    if (!obj.length) {
      if (options.addBreakTokens === true) {
        return [simpleTokens.emptyArray, new Token(Type.break)];
      }
      return simpleTokens.emptyArray;
    }
    refStack = Ref.createCheck(refStack, obj);
    const entries = [];
    let i = 0;
    for (const e of obj) {
      entries[i++] = objectToTokens(e, options, refStack);
    }
    if (options.addBreakTokens) {
      return [new Token(Type.array, obj.length), entries, new Token(Type.break)];
    }
    return [new Token(Type.array, obj.length), entries];
  },
  Object(obj, typ, options, refStack) {
    const isMap = typ !== "Object";
    const keys = isMap ? obj.keys() : Object.keys(obj);
    const maxLength = isMap ? obj.size : keys.length;
    let entries;
    if (maxLength) {
      entries = new Array(maxLength);
      refStack = Ref.createCheck(refStack, obj);
      const skipUndefined = !isMap && options.ignoreUndefinedProperties;
      let i = 0;
      for (const key of keys) {
        const value = isMap ? obj.get(key) : obj[key];
        if (skipUndefined && value === undefined) {
          continue;
        }
        entries[i++] = [
          objectToTokens(key, options, refStack),
          objectToTokens(value, options, refStack)
        ];
      }
      if (i < maxLength) {
        entries.length = i;
      }
    }
    if (!entries?.length) {
      if (options.addBreakTokens === true) {
        return [simpleTokens.emptyMap, new Token(Type.break)];
      }
      return simpleTokens.emptyMap;
    }
    sortMapEntries(entries, options);
    if (options.addBreakTokens) {
      return [new Token(Type.map, entries.length), entries, new Token(Type.break)];
    }
    return [new Token(Type.map, entries.length), entries];
  },
  Tagged(obj, _typ, options, refStack) {
    return [
      new Token(Type.tag, obj.tag),
      objectToTokens(obj.value, options, refStack)
    ];
  }
};
typeEncoders.Map = typeEncoders.Object;
function boxedEncoder(valueOf) {
  return (obj, typ, options, refStack) => {
    let primitive;
    try {
      primitive = valueOf.call(obj);
    } catch {
      throw new Error(`${encodeErrPrefix} unsupported type: ${typ} (object only claims the tag via Symbol.toStringTag)`);
    }
    return objectToTokens(primitive, options, refStack);
  };
}
typeEncoders.Number = boxedEncoder(Number.prototype.valueOf);
typeEncoders.String = boxedEncoder(String.prototype.valueOf);
typeEncoders.Boolean = boxedEncoder(Boolean.prototype.valueOf);
typeEncoders.BigInt = boxedEncoder(BigInt.prototype.valueOf);
typeEncoders.Buffer = typeEncoders.Uint8Array;
for (const typ of "Uint8Clamped Uint16 Uint32 Int8 Int16 Int32 BigUint64 BigInt64 Float32 Float64".split(" ")) {
  typeEncoders[`${typ}Array`] = typeEncoders.DataView;
}
function objectToTokens(obj, options = {}, refStack) {
  const typ = is(obj);
  const customTypeEncoder = options && options.typeEncoders && options.typeEncoders[typ] || typeEncoders[typ];
  if (typeof customTypeEncoder === "function") {
    const tokens = customTypeEncoder(obj, typ, options, refStack);
    if (tokens != null) {
      return tokens;
    }
  }
  const typeEncoder = typeEncoders[typ];
  if (!typeEncoder) {
    throw new Error(`${encodeErrPrefix} unsupported type: ${typ}`);
  }
  return typeEncoder(obj, typ, options, refStack);
}
function sortMapEntries(entries, options) {
  const mapSorter = options.mapSorter;
  if (mapSorter) {
    entries.sort((e1, e2) => mapSorter(e1, e2, options));
  }
}
var warnedComplexKeys = false;
function mapSorter(e1, e2, options) {
  const keyToken1 = Array.isArray(e1[0]) ? e1[0][0] : e1[0];
  const keyToken2 = Array.isArray(e2[0]) ? e2[0][0] : e2[0];
  if (keyToken1.type.major !== keyToken2.type.major) {
    return keyToken1.type.compare(keyToken2.type);
  }
  const major = keyToken1.type.major;
  const tcmp = cborEncoders[major].compareTokens(keyToken1, keyToken2, options);
  if (tcmp === 0) {
    if (major <= Type.string.major) {
      throw new Error(`${encodeErrPrefix} duplicate map key`);
    }
    if (!warnedComplexKeys) {
      warnedComplexKeys = true;
      console.warn("WARNING: complex key types used, CBOR key sorting guarantees are gone");
    }
  }
  return tcmp;
}
function rfc8949MapSorter(e1, e2) {
  if (e1[0] instanceof Token && e2[0] instanceof Token) {
    const t1 = e1[0];
    const t2 = e2[0];
    if (!t1._keyBytes) {
      t1._keyBytes = encodeRfc8949(t1.value);
    }
    if (!t2._keyBytes) {
      t2._keyBytes = encodeRfc8949(t2.value);
    }
    const cmp = compare(t1._keyBytes, t2._keyBytes);
    if (cmp === 0) {
      throw new Error(`${encodeErrPrefix} duplicate map key`);
    }
    return cmp;
  }
  throw new Error("rfc8949MapSorter: complex key types are not supported yet");
}
function encodeRfc8949(data) {
  return encodeCustom(data, cborEncoders, rfc8949EncodeOptions);
}
function tokensToEncoded(writer, tokens, encoders, options) {
  if (Array.isArray(tokens)) {
    for (const token of tokens) {
      tokensToEncoded(writer, token, encoders, options);
    }
  } else {
    encoders[tokens.type.major](writer, tokens, options);
  }
}
var MAJOR_UINT = Type.uint.majorEncoded;
var MAJOR_NEGINT = Type.negint.majorEncoded;
var MAJOR_BYTES = Type.bytes.majorEncoded;
var MAJOR_STRING = Type.string.majorEncoded;
var MAJOR_ARRAY = Type.array.majorEncoded;
var MAJOR_MAP = Type.map.majorEncoded;
var SIMPLE_FALSE = Type.float.majorEncoded | MINOR_FALSE;
var SIMPLE_TRUE = Type.float.majorEncoded | MINOR_TRUE;
var SIMPLE_NULL = Type.float.majorEncoded | MINOR_NULL;
var SIMPLE_UNDEFINED = Type.float.majorEncoded | MINOR_UNDEFINED;
var neg1b2 = BigInt(-1);
var pos1b2 = BigInt(1);
function directEncodeUintValue(writer, major, uint) {
  if (uint < 24) {
    writer.pushByte(major | Number(uint));
  } else {
    encodeUintValue(writer, major, uint);
  }
}
function canDirectEncode(options) {
  return options.addBreakTokens !== true;
}
function asciiKeyCompare(a, b) {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}
function asciiEntryCompare(a, b) {
  return asciiKeyCompare(a[0], b[0]);
}
var ASCII_KEY_MAX = 256;
var ASCII_INSERTION_MAX = 16;
function directEncodeAsciiEntry(writer, key, value, options, refStack) {
  const bytes = fromString(key);
  directEncodeUintValue(writer, MAJOR_STRING, bytes.length);
  if (Array.isArray(bytes)) {
    writer.pushArr(bytes);
  } else {
    writer.pushBytes(bytes);
  }
  directEncode(writer, value, options, refStack);
}
function directEncodeAsciiObject(writer, data, keys, options, refStack) {
  const n = keys.length;
  for (let i = 0;i < n; i++) {
    const key = keys[i];
    if (key.length > ASCII_KEY_MAX) {
      return false;
    }
    for (let j = 0;j < key.length; j++) {
      if (key.charCodeAt(j) > 127) {
        return false;
      }
    }
  }
  if (n === 0) {
    writer.pushByte(MAJOR_MAP);
    return true;
  }
  refStack = Ref.createCheck(refStack, data);
  const skipUndefined = options.ignoreUndefinedProperties;
  let length = 0;
  if (n <= ASCII_INSERTION_MAX) {
    const ks = new Array(n);
    const vs = new Array(n);
    for (let i = 0;i < n; i++) {
      const key = keys[i];
      const value = data[key];
      if (skipUndefined && value === undefined) {
        continue;
      }
      let j = length++;
      while (j > 0 && asciiKeyCompare(ks[j - 1], key) > 0) {
        ks[j] = ks[j - 1];
        vs[j] = vs[j - 1];
        j--;
      }
      ks[j] = key;
      vs[j] = value;
    }
    if (length === 0) {
      writer.pushByte(MAJOR_MAP);
      return true;
    }
    directEncodeUintValue(writer, MAJOR_MAP, length);
    for (let i = 0;i < length; i++) {
      directEncodeAsciiEntry(writer, ks[i], vs[i], options, refStack);
    }
  } else {
    const entries = [];
    for (let i = 0;i < n; i++) {
      const key = keys[i];
      const value = data[key];
      if (skipUndefined && value === undefined) {
        continue;
      }
      entries.push([key, value]);
    }
    entries.sort(asciiEntryCompare);
    length = entries.length;
    if (length === 0) {
      writer.pushByte(MAJOR_MAP);
      return true;
    }
    directEncodeUintValue(writer, MAJOR_MAP, length);
    for (let i = 0;i < length; i++) {
      directEncodeAsciiEntry(writer, entries[i][0], entries[i][1], options, refStack);
    }
  }
  return true;
}
function directEncodeMap(writer, data, typ, options, refStack, objectKeys) {
  const isMap = typ === "Map";
  const keys = isMap ? data.keys() : objectKeys || Object.keys(data);
  const maxLength = isMap ? data.size : keys.length;
  if (!maxLength) {
    writer.pushByte(MAJOR_MAP);
    return;
  }
  refStack = Ref.createCheck(refStack, data);
  const skipUndefined = !isMap && options.ignoreUndefinedProperties;
  const entries = new Array(maxLength);
  let length = 0;
  for (const key of keys) {
    const value = isMap ? data.get(key) : data[key];
    if (skipUndefined && value === undefined) {
      continue;
    }
    entries[length++] = [objectToTokens(key, options, refStack), value];
  }
  if (length === 0) {
    writer.pushByte(MAJOR_MAP);
    return;
  }
  if (length < maxLength) {
    entries.length = length;
  }
  entries.sort((e1, e2) => mapSorter(e1, e2, options));
  directEncodeUintValue(writer, MAJOR_MAP, length);
  for (const [key, value] of entries) {
    tokensToEncoded(writer, key, cborEncoders, options);
    directEncode(writer, value, options, refStack);
  }
}
function directEncode(writer, data, options, refStack) {
  const typ = is(data);
  const customEncoder = options.typeEncoders && options.typeEncoders[typ];
  if (customEncoder) {
    const tokens = customEncoder(data, typ, options, refStack);
    if (tokens != null) {
      tokensToEncoded(writer, tokens, cborEncoders, options);
      return;
    }
  }
  switch (typ) {
    case "null":
      writer.pushByte(SIMPLE_NULL);
      return;
    case "undefined":
      writer.pushByte(SIMPLE_UNDEFINED);
      return;
    case "boolean":
      writer.pushByte(data ? SIMPLE_TRUE : SIMPLE_FALSE);
      return;
    case "number":
      if (!Number.isInteger(data) || !Number.isSafeInteger(data)) {
        encodeFloat(writer, new Token(Type.float, data), options);
      } else if (data >= 0) {
        directEncodeUintValue(writer, MAJOR_UINT, data);
      } else {
        directEncodeUintValue(writer, MAJOR_NEGINT, data * -1 - 1);
      }
      return;
    case "bigint":
      if (data >= BigInt(0)) {
        directEncodeUintValue(writer, MAJOR_UINT, data);
      } else {
        directEncodeUintValue(writer, MAJOR_NEGINT, data * neg1b2 - pos1b2);
      }
      return;
    case "string": {
      const bytes = fromString(data);
      directEncodeUintValue(writer, MAJOR_STRING, bytes.length);
      if (Array.isArray(bytes)) {
        writer.pushArr(bytes);
      } else {
        writer.pushBytes(bytes);
      }
      return;
    }
    case "Uint8Array":
      directEncodeUintValue(writer, MAJOR_BYTES, data.length);
      writer.pushBytes(data);
      return;
    case "Array":
      if (!data.length) {
        writer.pushByte(MAJOR_ARRAY);
        return;
      }
      refStack = Ref.createCheck(refStack, data);
      directEncodeUintValue(writer, MAJOR_ARRAY, data.length);
      for (const elem of data) {
        directEncode(writer, elem, options, refStack);
      }
      return;
    case "Object":
    case "Map":
      if (options.mapSorter === mapSorter) {
        const keys = typ === "Object" ? Object.keys(data) : undefined;
        if (keys !== undefined && !(options.typeEncoders && options.typeEncoders.string) && directEncodeAsciiObject(writer, data, keys, options, refStack)) {
          return;
        }
        directEncodeMap(writer, data, typ, options, refStack, keys);
      } else {
        const tokens = typeEncoders.Object(data, typ, options, refStack);
        tokensToEncoded(writer, tokens, cborEncoders, options);
      }
      return;
    default: {
      const typeEncoder = typeEncoders[typ];
      if (!typeEncoder) {
        throw new Error(`${encodeErrPrefix} unsupported type: ${typ}`);
      }
      const tokens = typeEncoder(data, typ, options, refStack);
      tokensToEncoded(writer, tokens, cborEncoders, options);
    }
  }
}
function encodeCustom(data, encoders, options, destination) {
  const hasDest = destination !== undefined;
  const tokens = objectToTokens(data, options);
  if (!Array.isArray(tokens) && options.quickEncodeToken) {
    const quickBytes = options.quickEncodeToken(tokens);
    if (quickBytes) {
      if (hasDest) {
        const writeTo = new U8Writer(destination);
        writeTo.pushBytes(quickBytes);
        return writeTo.toBytes();
      }
      return quickBytes;
    }
    const encoder = encoders[tokens.type.major];
    if (encoder.encodedSize) {
      const size = encoder.encodedSize(tokens, options);
      if (hasDest) {
        const writeTo = new U8Writer(destination);
        encoder(writeTo, tokens, options);
        return writeTo.toBytes();
      }
      const out = new Uint8Array(size);
      const sized = new U8Writer(out);
      encoder(sized, tokens, options);
      if (sized.cursor !== size) {
        throw new Error(`Unexpected error: pre-calculated length for ${tokens} was wrong`);
      }
      return out;
    }
  }
  const writeTo = hasDest ? new U8Writer(destination) : defaultWriterBusy ? new FlatWriter : defaultWriter;
  writeTo.reset();
  tokensToEncoded(writeTo, tokens, encoders, options);
  return writeTo.toBytes(true);
}
function encode(data, options) {
  options = Object.assign({}, defaultEncodeOptions, options);
  if (canDirectEncode(options)) {
    if (defaultWriterBusy) {
      const writer = new FlatWriter;
      directEncode(writer, data, options, undefined);
      return writer.toBytes();
    }
    defaultWriterBusy = true;
    try {
      defaultWriter.reset();
      directEncode(defaultWriter, data, options, undefined);
      return defaultWriter.toBytes(true);
    } finally {
      defaultWriterBusy = false;
    }
  }
  return encodeCustom(data, cborEncoders, options);
}

// node_modules/cborg/lib/decode.js
var defaultDecodeOptions = {
  strict: false,
  allowIndefinite: true,
  allowUndefined: true,
  allowBigInt: true
};

class Tokeniser {
  constructor(data, options = {}) {
    this._pos = 0;
    this.data = data;
    this.options = options;
  }
  pos() {
    return this._pos;
  }
  done() {
    return this._pos >= this.data.length;
  }
  next() {
    const byt = this.data[this._pos];
    let token = quick[byt];
    if (token === undefined) {
      const decoder = jump[byt];
      if (!decoder) {
        if (byt === undefined) {
          throw new Error(`${decodeErrPrefix} not enough data`);
        }
        throw new Error(`${decodeErrPrefix} no decoder for major type ${byt >>> 5} (byte 0x${byt.toString(16).padStart(2, "0")})`);
      }
      const minor = byt & 31;
      token = decoder(this.data, this._pos, minor, this.options);
    }
    this._pos += token.encodedLength;
    return token;
  }
}
var DONE = Symbol.for("DONE");
var BREAK = Symbol.for("BREAK");
function tokenToArray(token, tokeniser, options) {
  const arr = [];
  for (let i = 0;i < token.value; i++) {
    const value = tokensToObject(tokeniser, options);
    if (value === BREAK) {
      if (token.value === Infinity) {
        break;
      }
      throw new Error(`${decodeErrPrefix} got unexpected break to lengthed array`);
    }
    if (value === DONE) {
      throw new Error(`${decodeErrPrefix} found array but not enough entries (got ${i}, expected ${token.value})`);
    }
    arr[i] = value;
  }
  return arr;
}
function tokenToMap(token, tokeniser, options) {
  const useMaps = options.useMaps === true;
  const rejectDuplicateMapKeys = options.rejectDuplicateMapKeys === true;
  const obj = useMaps ? undefined : {};
  const m = useMaps ? new Map : undefined;
  for (let i = 0;i < token.value; i++) {
    const key = tokensToObject(tokeniser, options);
    if (key === BREAK) {
      if (token.value === Infinity) {
        break;
      }
      throw new Error(`${decodeErrPrefix} got unexpected break to lengthed map`);
    }
    if (key === DONE) {
      throw new Error(`${decodeErrPrefix} found map but not enough entries (got ${i} [no key], expected ${token.value})`);
    }
    if (!useMaps && typeof key !== "string") {
      throw new Error(`${decodeErrPrefix} non-string keys not supported (got ${typeof key})`);
    }
    if (rejectDuplicateMapKeys) {
      if (useMaps && m.has(key) || !useMaps && Object.hasOwn(obj, key)) {
        throw new Error(`${decodeErrPrefix} found repeat map key "${key}"`);
      }
    }
    const value = tokensToObject(tokeniser, options);
    if (value === DONE) {
      throw new Error(`${decodeErrPrefix} found map but not enough entries (got ${i} [no value], expected ${token.value})`);
    }
    if (value === BREAK) {
      throw new Error(`${decodeErrPrefix} got unexpected break to map value`);
    }
    if (useMaps) {
      m.set(key, value);
    } else if (key === "__proto__") {
      Object.defineProperty(obj, key, { value, configurable: true, enumerable: true, writable: true });
    } else {
      obj[key] = value;
    }
  }
  return useMaps ? m : obj;
}
function* tokenToMapEntries(token, tokeniser, options) {
  const seen = token.value > 1 && options.rejectDuplicateMapKeys === true ? new Set : undefined;
  for (let i = 0;i < token.value; i++) {
    const key = tokensToObject(tokeniser, options);
    if (key === BREAK) {
      if (token.value === Infinity) {
        break;
      }
      throw new Error(`${decodeErrPrefix} got unexpected break to lengthed map`);
    }
    if (key === DONE) {
      throw new Error(`${decodeErrPrefix} found map but not enough entries (got ${i} [no key], expected ${token.value})`);
    }
    if (seen && seen.add(key).size !== i + 1) {
      throw new Error(`${decodeErrPrefix} found repeat map key`);
    }
    const value = tokensToObject(tokeniser, options);
    if (value === DONE) {
      throw new Error(`${decodeErrPrefix} found map but not enough entries (got ${i} [no value], expected ${token.value})`);
    }
    if (value === BREAK) {
      throw new Error(`${decodeErrPrefix} got unexpected break to map value`);
    }
    yield [key, value];
  }
}
function createTagDecodeControl(tokeniser, options) {
  const decode = function() {
    if (decode._called) {
      throw new Error(`${decodeErrPrefix} tag decode() may only be called once`);
    }
    decode._called = true;
    const value = tokensToObject(tokeniser, options);
    if (value === DONE) {
      throw new Error(`${decodeErrPrefix} tag content missing`);
    }
    if (value === BREAK) {
      throw new Error(`${decodeErrPrefix} got unexpected break in tag content`);
    }
    return value;
  };
  decode.entries = function() {
    if (decode._called) {
      throw new Error(`${decodeErrPrefix} tag decode() may only be called once`);
    }
    decode._called = true;
    if (tokeniser.done()) {
      throw new Error(`${decodeErrPrefix} tag content missing`);
    }
    const token = tokeniser.next();
    if (!Type.equals(token.type, Type.map)) {
      throw new Error(`${decodeErrPrefix} entries() requires map content, got ${token.type.name}`);
    }
    const entries = [];
    for (const entry of tokenToMapEntries(token, tokeniser, options)) {
      entries.push(entry);
    }
    return entries;
  };
  decode._called = false;
  return decode;
}
function tokensToObject(tokeniser, options) {
  if (tokeniser.done()) {
    return DONE;
  }
  const token = tokeniser.next();
  if (Type.equals(token.type, Type.break)) {
    return BREAK;
  }
  if (token.type.terminal) {
    return token.value;
  }
  if (Type.equals(token.type, Type.array)) {
    return tokenToArray(token, tokeniser, options);
  }
  if (Type.equals(token.type, Type.map)) {
    return tokenToMap(token, tokeniser, options);
  }
  if (Type.equals(token.type, Type.tag)) {
    if (options.tags && typeof options.tags[token.value] === "function") {
      const decodeControl = createTagDecodeControl(tokeniser, options);
      const result = options.tags[token.value](decodeControl);
      if (!decodeControl._called) {
        throw new Error(`${decodeErrPrefix} tag decoder must call decode() or entries()`);
      }
      return result;
    }
    throw new Error(`${decodeErrPrefix} tag not supported (${token.value})`);
  }
  throw new Error("unsupported");
}
function decodeFirst(data, options) {
  if (!(data instanceof Uint8Array)) {
    throw new Error(`${decodeErrPrefix} data to decode must be a Uint8Array`);
  }
  options = Object.assign({}, defaultDecodeOptions, options);
  const u8aData = asU8A(data);
  const tokeniser = options.tokenizer || new Tokeniser(u8aData, options);
  const decoded = tokensToObject(tokeniser, options);
  if (decoded === DONE) {
    throw new Error(`${decodeErrPrefix} did not find any content to decode`);
  }
  if (decoded === BREAK) {
    throw new Error(`${decodeErrPrefix} got unexpected break`);
  }
  return [decoded, data.subarray(tokeniser.pos())];
}
function decode(data, options) {
  const [decoded, remainder] = decodeFirst(data, options);
  if (remainder.length > 0) {
    throw new Error(`${decodeErrPrefix} too many terminals, data makes no sense`);
  }
  return decoded;
}

// node_modules/cborg/lib/tagged.js
class Tagged {
  constructor(tag, value) {
    if (typeof tag !== "number" || !Number.isInteger(tag) || tag < 0) {
      throw new TypeError("Tagged: tag must be a non-negative integer");
    }
    this.tag = tag;
    this.value = value;
  }
  static decoder(tag) {
    return (decode) => new Tagged(tag, decode());
  }
  static preserve(...tagNumbers) {
    const tags = {};
    for (const tag of tagNumbers) {
      tags[tag] = Tagged.decoder(tag);
    }
    return tags;
  }
}
Object.defineProperty(Tagged.prototype, Symbol.toStringTag, {
  value: "Tagged"
});

// src/wire.js
var maxFrameBytes = 16 * 1024 * 1024;
var crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte;
  for (let bit = 0;bit < 8; bit++)
    crc = crc >>> 1 ^ (crc & 1 ? 3988292384 : 0);
  return crc >>> 0;
});
function crc32(bytes) {
  let crc = 4294967295;
  for (const byte of bytes)
    crc = crc >>> 8 ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 4294967295) >>> 0;
}
function malformed() {
  return new Error("Invalid Quick event-stream frame");
}
function encodeEventStream(headers, body) {
  const fields = Object.entries(headers).map(([name, value]) => {
    const key = Buffer.from(name);
    const data = Buffer.from(value);
    const field = Buffer.alloc(1 + key.length + 3 + data.length);
    field[0] = key.length;
    key.copy(field, 1);
    field[1 + key.length] = 7;
    field.writeUInt16BE(data.length, 2 + key.length);
    data.copy(field, 4 + key.length);
    return field;
  });
  const block = Buffer.concat(fields);
  const message = Buffer.alloc(16 + block.length + body.length);
  message.writeUInt32BE(message.length, 0);
  message.writeUInt32BE(block.length, 4);
  message.writeUInt32BE(crc32(message.subarray(0, 8)), 8);
  block.copy(message, 12);
  Buffer.from(body).copy(message, 12 + block.length);
  message.writeUInt32BE(crc32(message.subarray(0, -4)), message.length - 4);
  return message;
}
function stringHeaders(block) {
  const headers = new Map;
  const fixedLengths = [0, 0, 1, 2, 4, 8, null, null, 8, 16];
  for (let offset = 0;offset < block.length; ) {
    const endName = offset + 1 + block[offset];
    if (endName >= block.length)
      throw malformed();
    const name = block.toString("utf8", offset + 1, endName);
    const type = block[endName];
    offset = endName + 1;
    let size = fixedLengths[type];
    if (type === 6 || type === 7) {
      if (offset + 2 > block.length)
        throw malformed();
      size = block.readUInt16BE(offset);
      offset += 2;
    }
    if (size === undefined || offset + size > block.length)
      throw malformed();
    if (type === 7)
      headers.set(name, block.toString("utf8", offset, offset + size));
    offset += size;
  }
  return headers;
}
function quickError(message, status = 502) {
  return Object.assign(new Error(message), { status });
}
function upstreamFailure(code) {
  const name = String(code ?? "").toLowerCase();
  const statuses = {
    accessdeniedexception: 403,
    unauthorizedexception: 401,
    unauthorized: 401,
    notauthorizedexception: 401,
    expiredtokenexception: 401,
    throttlingexception: 429,
    throttled: 429,
    toomanyrequests: 429,
    toomanyrequestsexception: 429
  };
  const status = /^[45]\d{2}$/.test(name) ? Number(name) : Object.hasOwn(statuses, name) ? statuses[name] : 502;
  return quickError("Amazon Quick reported an upstream error", status);
}
function encodeQuickFrame(event, gateway) {
  const body = Buffer.from(JSON.stringify(event));
  if (!gateway) {
    return Buffer.from(JSON.stringify({ eventType: "rawInputEvent", payload: { payload: body.toString("base64") } }));
  }
  return encodeEventStream({
    ":event-type": "rawInputEvent",
    ":content-type": "application/cbor",
    ":message-type": "event"
  }, encode({ payload: new Uint8Array(body) }));
}
function parseJSON(bytes) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw malformed();
  }
}
function decodeQuickFrame(data, binary, gateway) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (!binary || bytes[0] > 1)
    return [parseJSON(bytes)];
  const events = [];
  for (let offset = 0;offset < bytes.length; ) {
    if (bytes.length - offset < 16)
      throw malformed();
    const size = bytes.readUInt32BE(offset);
    const headerSize = bytes.readUInt32BE(offset + 4);
    if (size < 16 || size > maxFrameBytes || headerSize > size - 16 || offset + size > bytes.length)
      throw malformed();
    const frame = bytes.subarray(offset, offset + size);
    if (crc32(frame.subarray(0, 8)) !== frame.readUInt32BE(8) || crc32(frame.subarray(0, -4)) !== frame.readUInt32BE(size - 4))
      throw malformed();
    const headers = stringHeaders(frame.subarray(12, 12 + headerSize));
    if (["error", "exception"].includes(headers.get(":message-type"))) {
      throw upstreamFailure(headers.get(":error-code") || headers.get(":exception-type"));
    }
    const body = frame.subarray(12 + headerSize, -4);
    if (gateway) {
      let envelope;
      try {
        envelope = decode(body, { tags: { 55799: (decode) => decode() } });
      } catch {
        throw malformed();
      }
      const payload = envelope?.payload;
      if (!(payload instanceof Uint8Array) && typeof payload !== "string")
        throw malformed();
      events.push(parseJSON(Buffer.from(payload)));
    } else {
      const payload = parseJSON(body)?.payload;
      if (typeof payload !== "string")
        throw malformed();
      events.push(parseJSON(Buffer.from(payload, "base64")));
    }
    offset += size;
  }
  return events;
}

// src/transport.js
var aidpPath = "/streaming/quickwork-chat-bidirectional-stream";
var gatewayPath = "/ws/service/SpaceNeedleConversationService/operation/ChatBidirectionalStream";
var terminal = new Set(["turn_completed", "turn_ended", "stream_ended", "chat_complete"]);
var toolEvents = new Set([
  "tool_start",
  "tool_arguments",
  "tool_arguments_edited",
  "tool_progress",
  "tool_result",
  "tool_error",
  "tool_complete",
  "tool_call",
  "tool_call_update"
]);
function destination(session, gateway, { surface, outpostId, workingSessionId }) {
  const host = session.wsHost;
  const path = gateway ? gatewayPath : aidpPath;
  if (typeof host !== "string" || !/^[a-z0-9.-]+$/.test(host) || !isQuickHost(host) || session.wsPath && session.wsPath !== path) {
    throw quickError("Invalid Amazon Quick connection endpoint", 400);
  }
  if (typeof session.jwt !== "string" || !session.jwt || /[\s\x00-\x1f\x7f]/.test(session.jwt)) {
    throw quickError("Amazon Quick sign-in is required", 401);
  }
  const url = new URL("wss://" + host + path);
  if (!gateway) {
    url.searchParams.set("surfaceType", surface);
    if (outpostId)
      url.searchParams.set("outpostId", outpostId);
    if (workingSessionId)
      url.searchParams.set("workingSessionId", workingSessionId);
    if (session.provider === "social")
      url.searchParams.set("token", session.jwt);
  }
  return url;
}
function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function usageEvent(p) {
  const cached = count(p.cache_read_tokens);
  const inputs = count(p.input_tokens) + cached + count(p.cache_write_tokens);
  const outputs = count(p.output_tokens);
  const total = count(p.total_tokens) || inputs + outputs;
  const usage = {
    type: "usage",
    prompt_tokens: total >= outputs ? total - outputs : inputs,
    completion_tokens: outputs,
    cached_tokens: cached,
    total_tokens: total
  };
  if (Number.isSafeInteger(p.duration_ms) && p.duration_ms >= 0)
    usage.duration_ms = p.duration_ms;
  return usage;
}
function rememberTool(tools, p) {
  const name = p.tool_name || p.name || p.function?.name || p.title;
  const fromWire = p.tool_id || p.tool_call_id || p.toolCallId || p.id;
  if (!fromWire && !name)
    return;
  const key = fromWire || name;
  const tool = tools.get(key) || { type: "tool", id: fromWire || "call_" + randomUUID2(), name: "", arguments: "" };
  if (typeof name === "string")
    tool.name = name;
  const args = p.arguments ?? p.function?.arguments ?? p.rawInput ?? p.raw_input;
  const delta = p.input_delta ?? p.progress?.input_delta;
  if (args != null)
    tool.arguments = typeof args === "string" ? args : JSON.stringify(args);
  else if (typeof delta === "string")
    tool.arguments += delta;
  tools.set(key, tool);
}
function stamp() {
  return { epoch: Date.now(), monotonic: performance.now() };
}
async function* streamQuick(session, input, signal, connect = (url, options) => new WebSocket(url, options)) {
  const abortError = () => signal.reason?.name === "TimeoutError" ? quickError("Amazon Quick request timed out", 504) : quickError("Amazon Quick request canceled", 499);
  if (signal?.aborted)
    throw abortError();
  if (!input.prompt?.trim())
    throw quickError("Quick requires a non-empty message", 400);
  const gateway = session.provider === "gateway" || session.provider === "social_gateway";
  const options = input.clientOptions ?? defaultOptions;
  const { appVersion, surface, outpostId, workingSessionId } = options;
  const url = destination(session, gateway, options);
  const thread = input.threadId || randomUUID2();
  const title = input.title || Array.from(input.prompt.replace(/\s+/g, " ").trim()).slice(0, 60).join("");
  let socket;
  try {
    socket = connect(url, {
      headers: {
        Authorization: "Bearer " + session.jwt,
        Origin: "file://",
        "X-Surface-Type": surface,
        "X-Outpost-Id": outpostId,
        "X-Agent-Service-Type": "UNIFIED_QUICK",
        ...workingSessionId ? { "X-Working-Session-Id": workingSessionId } : {}
      },
      followRedirects: false,
      handshakeTimeout: 20000,
      maxPayload: 16 * 1024 * 1024
    });
  } catch {
    throw quickError("Could not open the Amazon Quick connection");
  }
  const bus = new EventEmitter;
  const packets = on(bus, "packet");
  const push = (packet) => bus.emit("packet", packet);
  let started, progress, completed, quietTimer, idleTimer;
  function closeConnection() {
    if (socket.readyState === WebSocket.OPEN) {
      try {
        if (started && !options.keepSessions)
          send("session_delete", { session_id: thread });
        socket.close();
      } catch {
        socket.terminate();
      }
    } else if (socket.readyState === WebSocket.CONNECTING)
      socket.terminate();
  }
  socket.once("open", () => push({ kind: "open" }));
  socket.on("message", (data, binary) => {
    idleTimer?.refresh();
    push({ kind: "message", data, binary, at: stamp() });
  });
  socket.on("error", (error) => {
    const match = /^Unexpected server response: ([1-5]\d{2})$/.exec(error.message);
    const status = match ? Number(match[1]) : 502;
    push({ error: quickError("Amazon Quick connection failed (HTTP " + status + ")", status) });
  });
  socket.once("close", (code) => push({ kind: "closed", code }));
  function abort() {
    push({ error: abortError() });
    closeConnection();
  }
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted)
    abort();
  const deadline = setTimeout(() => {
    push({ error: quickError("Amazon Quick request timed out", 504) });
    closeConnection();
  }, options.requestTimeoutSeconds * 1000);
  const keepalive = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.ping();
      } catch {
        push({ error: quickError("Amazon Quick connection lost") });
      }
    }
  }, 25000);
  function send(type, payload) {
    socket.send(encodeQuickFrame({ type, payload }, gateway), { binary: true });
  }
  const tools = new Map;
  const textMessages = new Set;
  let sawUsage = false, completeUsage = true, reportedMs = 0;
  try {
    loop:
      for await (const [packet] of packets) {
        if (signal?.aborted)
          throw abortError();
        if (packet.error)
          throw packet.error;
        if (packet.kind === "open") {
          if (gateway) {
            socket.send(encodeQuickFrame({ type: "session_connect", session_id: outpostId }, true), { binary: true });
          } else {
            send("session_connect", {
              actor_id: session.actorArn || "",
              surfaceType: surface,
              outpostId,
              appVersion,
              external_agent_sign_in: 1,
              recents_promotion: 1
            });
          }
          send("federate_status", {});
          send("session_create", { session_id: thread, title });
          send("user_message", {
            text: input.prompt,
            send_origin: "programmatic",
            had_physical_input: false,
            surfaceType: surface,
            outpostId,
            appVersion,
            traceId: randomUUID2(),
            message_id: randomUUID2(),
            thread_id: thread,
            agent_mode: input.model || "smart",
            user_timezone: options.timezone,
            user_locale: options.locale,
            chat_agent_id: null,
            auto_routing: false,
            web_search_enabled: false,
            pre_approved_tools: [],
            preload_skills: [],
            panel_edits: [],
            custom_prompt: null,
            ...input.systemPrompt ? { system_prompt: input.systemPrompt } : {},
            ...options.thinkingEffort !== "off" ? { thinking_effort: options.thinkingEffort } : {}
          });
          started = stamp();
          idleTimer = setTimeout(() => push({ kind: "idle" }), 120000);
          continue;
        }
        if (packet.kind === "finished")
          break;
        if (packet.kind === "idle") {
          if (completed && progress)
            break;
          throw quickError("Amazon Quick stopped sending events", 504);
        }
        if (packet.kind === "closed") {
          if (progress && (completed || packet.code === 1000))
            break;
          throw quickError("Amazon Quick closed the connection (" + packet.code + ")");
        }
        for (const event of decodeQuickFrame(packet.data, packet.binary, gateway)) {
          if (signal?.aborted)
            throw abortError();
          const type = event?.type;
          const p = event?.payload ?? {};
          if (type === "text_delta" || type === "text_complete") {
            const text = typeof p === "string" ? p : p.delta || p.text;
            const message = event.message_id || p.message_id || "";
            if (type === "text_complete")
              completed = packet.at;
            if (typeof text === "string" && text && (type === "text_delta" || !textMessages.has(message))) {
              progress = packet.at;
              if (type === "text_delta") {
                completed = undefined;
                clearTimeout(quietTimer);
              }
              textMessages.add(message);
              yield { type: "text", text };
            }
          } else if (type === "turn_usage") {
            const usage = usageEvent(p);
            sawUsage = true;
            if (usage.duration_ms === undefined || !Number.isSafeInteger(reportedMs + usage.duration_ms)) {
              completeUsage = false;
            } else {
              reportedMs += usage.duration_ms;
            }
            if (usage.duration_ms !== undefined || usage.total_tokens > 0)
              progress = packet.at;
            yield usage;
          } else if (toolEvents.has(type)) {
            rememberTool(tools, p);
            if (tools.size)
              progress = packet.at;
            completed = undefined;
            clearTimeout(quietTimer);
          } else if (type === "message_complete") {
            for (const tool of p.tool_calls || [])
              rememberTool(tools, tool);
            if (p.tool_calls?.length)
              progress = packet.at;
            clearTimeout(quietTimer);
            completed = p.continuation_expected ? undefined : completed || packet.at;
            if (p.continuation_expected)
              textMessages.delete("");
            if (!p.continuation_expected)
              quietTimer = setTimeout(() => push({ kind: "finished" }), 5000);
          } else if (terminal.has(type)) {
            completed ||= packet.at;
            break loop;
          } else if (["error", "turn_failed", "session_error", "stream_error", "turn_aborted"].includes(type)) {
            throw upstreamFailure(p.status_code || p.code || event.error_code);
          } else if (type === "ping" && socket.readyState === WebSocket.OPEN) {
            socket.pong();
          }
        }
      }
    for (const tool of tools.values()) {
      if (signal?.aborted)
        throw abortError();
      if (tool.name)
        yield { ...tool, arguments: tool.arguments || "{}" };
    }
  } catch (error) {
    if (error?.status)
      throw error;
    throw quickError("Could not process the Amazon Quick stream");
  } finally {
    signal?.removeEventListener("abort", abort);
    clearTimeout(deadline);
    clearTimeout(idleTimer);
    clearTimeout(quietTimer);
    clearInterval(keepalive);
    await packets.return();
    closeConnection();
    if (started && progress && input.onTiming) {
      const end = completed || progress;
      const durationMs = sawUsage && completeUsage ? reportedMs : Math.max(0, Math.round(end.monotonic - started.monotonic));
      await input.onTiming({ durationMs, endedAt: end.epoch });
    }
  }
}

// src/chat.js
function badRequest2(message, status = 400) {
  return Object.assign(new Error(message), { status, expose: true });
}
function publicError(err) {
  const status = err?.name === "TimeoutError" ? 504 : Number.isInteger(err?.status) && err.status >= 400 && err.status <= 599 ? err.status : 502;
  const messages = {
    400: "Invalid chat request",
    401: "Please sign in to Amazon Quick",
    403: "Amazon Quick denied access",
    429: "Amazon Quick rate limit reached",
    504: "Amazon Quick request timed out"
  };
  return { status, body: { error: {
    message: err?.expose ? err.message : messages[status] || "Amazon Quick request failed",
    type: status === 400 ? "invalid_request_error" : "upstream_error",
    code: status
  } } };
}
async function* updates(turn, events) {
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } };
  const tools = [], buffered = [];
  let hasText = false;
  for await (const event of events) {
    if (event.type === "text" && event.text) {
      hasText = true;
      if (turn.tools.enabled)
        buffered.push(event.text);
      else
        yield { delta: { content: event.text } };
    } else if (event.type === "tool" && turn.tools.enabled) {
      tools.push(event);
    } else if (event.type === "usage") {
      for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"])
        usage[key] += event[key] ?? 0;
      usage.prompt_tokens_details.cached_tokens += event.cached_tokens ?? 0;
    }
  }
  let finish = "stop";
  if (turn.tools.enabled) {
    const result = finishTools(buffered.join(""), tools, turn.tools);
    if (result.text)
      yield { delta: { content: result.text } };
    hasText = Boolean(result.text);
    if (result.toolCalls.length) {
      const indexed = result.toolCalls.map((call, index) => ({ index, ...call }));
      yield { delta: { tool_calls: indexed } };
      finish = "tool_calls";
    }
  }
  if (!hasText && finish === "stop")
    throw new Error("Empty upstream reply");
  yield { finish, usage };
}
async function asJSON(iterator, base) {
  const content = [];
  const message = { role: "assistant", content: null };
  for await (const part of iterator) {
    if (part.delta?.content)
      content.push(part.delta.content);
    if (part.delta?.tool_calls)
      message.tool_calls = part.delta.tool_calls.map(({ index, ...call }) => call);
    if (part.finish) {
      message.content = content.length ? content.join("") : null;
      return Response.json({
        ...base,
        object: "chat.completion",
        usage: part.usage,
        choices: [{ index: 0, message, finish_reason: part.finish }]
      });
    }
  }
  throw new Error("Empty upstream reply");
}
function asStream(iterator, first, base, includeUsage, controller) {
  const encoder = new TextEncoder;
  const chunk = (delta, finish_reason = null) => ({
    ...base,
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta, finish_reason }]
  });
  async function* frames() {
    try {
      yield chunk({ role: "assistant" });
      let next = first;
      while (!next.done) {
        const part = next.value;
        if (part.delta)
          yield chunk(part.delta);
        else {
          yield chunk({}, part.finish);
          if (includeUsage)
            yield { ...base, object: "chat.completion.chunk", choices: [], usage: part.usage };
        }
        next = await iterator.next();
      }
    } catch (err) {
      yield publicError(err).body;
    } finally {
      await iterator.return();
    }
  }
  const chunks = frames();
  const body = new ReadableStream({
    async pull(out) {
      const item = await chunks.next();
      if (item.done) {
        out.enqueue(encoder.encode(`data: [DONE]

`));
        out.close();
      } else {
        out.enqueue(encoder.encode("data: " + JSON.stringify(item.value) + `

`));
      }
    },
    async cancel() {
      controller.abort();
      await chunks.return();
      await iterator.return();
    }
  });
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}
function createChatFetch({ baseURL, models, session, record, stream = streamQuick, clientOptions = defaultOptions }) {
  return async (url, init) => {
    const request = new Request(url, init);
    let signal = request.signal;
    try {
      if (request.url !== baseURL + "/chat/completions")
        throw badRequest2("Unsupported Amazon Quick endpoint", 404);
      if (request.method !== "POST")
        throw badRequest2("Use POST for chat completions", 405);
      let body;
      try {
        body = await request.json();
      } catch {
        throw badRequest2("Expected a JSON chat request");
      }
      if (!body || typeof body.model !== "string" || !Object.hasOwn(models, body.model))
        throw badRequest2("Unknown Amazon Quick model");
      if (body.n != null && body.n !== 1)
        throw badRequest2("Amazon Quick accepts one completion per request");
      const turn = prepareTurn(body);
      const controller = new AbortController;
      signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(clientOptions.requestTimeoutSeconds * 1000)]);
      signal.throwIfAborted();
      let account;
      try {
        account = await session();
      } catch (err) {
        throw Object.assign(new Error("Account unavailable"), { status: err?.status || 401 });
      }
      signal.throwIfAborted();
      const events = stream(account, { ...turn, clientOptions, onTiming: (timing) => record(account.accountId, timing) }, signal);
      const parts = updates(turn, events);
      const base = { id: "chatcmpl-" + randomUUID3(), created: Math.floor(Date.now() / 1000), model: body.model };
      if (!body.stream)
        return await asJSON(parts, base);
      const first = await parts.next();
      return asStream(parts, first, base, body.stream_options?.include_usage === true, controller);
    } catch (err) {
      if (request.signal.aborted)
        throw request.signal.reason;
      const { body, status } = publicError(signal.aborted ? signal.reason : err);
      return Response.json(body, { status });
    }
  };
}

// src/usage.js
import { mkdirSync } from "fs";
import { join } from "path";
async function withDatabase(directory, work) {
  const dir = join(directory, "amazon-quick");
  mkdirSync(dir, { recursive: true, mode: 448 });
  const SQLite = process.versions.bun ? (await import("bun:sqlite")).Database : (await import("node:sqlite")).DatabaseSync;
  const db = new SQLite(join(dir, "usage.sqlite"));
  try {
    db.exec("PRAGMA busy_timeout=5000");
    db.exec(`CREATE TABLE IF NOT EXISTS monthly_usage (
      account TEXT NOT NULL, month TEXT NOT NULL, millis INTEGER NOT NULL,
      PRIMARY KEY (account, month)
    )`);
    return work(db);
  } finally {
    db.close();
  }
}
function recordTurn(directory, account, { durationMs, endedAt }) {
  if (!Number.isFinite(durationMs) || durationMs < 0)
    throw new Error("Invalid turn duration");
  const month = new Date(endedAt).toISOString().slice(0, 7);
  return withDatabase(directory, (db) => db.prepare(`INSERT INTO monthly_usage VALUES (?, ?, ?)
    ON CONFLICT(account, month) DO UPDATE SET millis = millis + excluded.millis`).run(account, month, Math.round(durationMs)));
}
async function accountUsage(directory, session, hours, now = new Date) {
  const month = now.toISOString().slice(0, 7);
  const spent = await withDatabase(directory, (db) => db.prepare("SELECT millis FROM monthly_usage WHERE account = ? AND month = ?").get(session.accountId, month)?.millis ?? 0);
  const budget = hours * 3600000;
  const seconds = Math.floor(Math.max(0, budget - spent) / 1000);
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds / 60) % 60, s = seconds % 60;
  const display = [h && h + "\u5C0F\u65F6", m && m + "\u5206", s && s + "\u79D2"].filter(Boolean).join("") || "0\u79D2";
  return {
    user: session.email || "",
    windows: [{
      name: "\u672C\u6708\u5269\u4F59",
      display,
      used: Math.min(100, spent / budget * 100),
      resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
      aside: true
    }]
  };
}

// index.js
var provider = "amazon-quick";
var baseURL = "https://amazon-quick.invalid/v1";
var models = Object.fromEntries(["smart", "fast", "balanced", "auto"].map((mode) => [
  mode,
  { name: "Amazon Quick " + mode, tool_call: true, modalities: { input: ["text"], output: ["text"] } }
]));
async function AmazonQuickPlugin({ client, directory, magpie }, options = {}) {
  const dataDir = magpie && directory ? directory : join2(process.env.XDG_DATA_HOME || join2(homedir(), ".local", "share"), "magpie");
  const clientOptions = readOptions(options);
  let wizardAvailable = false;
  if (magpie) {
    try {
      await startLoginWizard(clientOptions.loginWizardPort);
      wizardAvailable = true;
    } catch {
      await client.app?.log?.({ body: { service: provider, level: "warn", message: "\u767B\u5F55\u5411\u5BFC\u7AEF\u53E3\u65E0\u6CD5\u76D1\u542C\u3002\u53EF\u4F7F\u7528\u4F9B\u5E94\u5546\u5361\u7247\u5B8C\u6210\u767B\u5F55\uFF0C\u6216\u5728\u63D2\u4EF6\u9AD8\u7EA7\u8BBE\u7F6E\u4E2D\u66F4\u6539\u7AEF\u53E3\u3002" } });
    }
  }
  return {
    async config(config) {
      config.provider ??= {};
      config.provider[provider] = {
        name: "Amazon Quick",
        npm: "@ai-sdk/openai-compatible",
        api: baseURL,
        ...config.provider[provider],
        models: { ...models, ...config.provider[provider]?.models }
      };
    },
    auth: {
      provider,
      methods: createAuthMethods(clientOptions, wizardAvailable),
      refresh: refreshAuth,
      async usage(getAuth) {
        return accountUsage(dataDir, sessionFromAuth(await getAuth()), clientOptions.monthlyHours);
      },
      async loader(getAuth) {
        async function session() {
          const account = magpie ? sessionFromAuth(await getAuth()) : await getSession(getAuth, (body) => client.auth.set({ path: { id: provider }, body }));
          if (clientOptions.transport === "gateway")
            account.provider = account.provider === "social" ? "social_gateway" : "gateway";
          return account;
        }
        return {
          baseURL,
          apiKey: provider,
          fetch: createChatFetch({
            baseURL,
            models,
            session,
            clientOptions,
            record: async (accountId, timing) => {
              try {
                await recordTurn(dataDir, accountId, timing);
              } catch {
                await client.app?.log?.({ body: { service: provider, level: "warn", message: "Could not save monthly usage" } });
              }
            }
          })
        };
      }
    }
  };
}
export {
  AmazonQuickPlugin
};
