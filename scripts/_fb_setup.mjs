// Autonomous feedback-fixture setup.
// For every message_key in data/.n8n_feedback.json:
//   1. fetch detail (full body up to 4000 + attachmentFiles + analysis) → docs/superpowers/fixtures/<key>.json
//   2. download each attachment's bytes → data/attachments/<key>/<safeName>  (so analyzeEmail can reparse locally)
// Uses node:https (robust against undici connect-timeout flakiness) with retries.
import https from "node:https";
import fs from "node:fs";
import path from "node:path";

const PROD = "pochta-production.up.railway.app";
const ADMIN_PASSWORD = "LgxaZ@ZDgNBXgSpnmTHEW6MC";
const ATT_TOKEN = "fd3d37534b3f64147b70e0e7bf6a622852fa720eeafb36410190f95cbb0dd7bf";
const FIX_DIR = "docs/superpowers/fixtures";
const ATT_ROOT = "data/attachments";
const PROJECTS = ["project-4-klvrt-mail", "project-3-mailbox-file"];

const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

function req(method, urlPath, { token, json, raw } = {}) {
    return new Promise((resolve, reject) => {
        const headers = {};
        let body = null;
        if (token) headers.Authorization = `Bearer ${token}`;
        if (json) { body = JSON.stringify(json); headers["Content-Type"] = "application/json"; headers["Content-Length"] = Buffer.byteLength(body); }
        const r = https.request({ hostname: PROD, port: 443, path: urlPath, method, headers, agent, timeout: 60000 }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks) }));
        });
        r.on("timeout", () => { r.destroy(); reject(new Error("timeout")); });
        r.on("error", reject);
        if (body) r.write(body);
        r.end();
    });
}

async function withRetry(fn, label, tries = 5) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
        try { return await fn(); }
        catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
    }
    throw new Error(`${label}: ${lastErr?.message || "failed"}`);
}

async function login() {
    const r = await withRetry(() => req("POST", "/api/auth/login", { json: { login: "admin", password: ADMIN_PASSWORD } }), "login");
    return JSON.parse(r.buf.toString()).token;
}

async function getDetail(token, proj, key) {
    const r = await withRetry(() => req("GET", `/api/projects/${proj}/messages/${encodeURIComponent(key)}`, { token }), `detail ${key}`);
    if (r.status !== 200) return null;
    return JSON.parse(r.buf.toString()).message;
}

async function download(token, key, safeName) {
    const url = `/api/attachments/${encodeURIComponent(key)}/${encodeURIComponent(safeName)}?token=${ATT_TOKEN}`;
    const r = await withRetry(() => req("GET", url, { token }), `att ${safeName}`);
    return r.status === 200 ? r.buf : null;
}

async function main() {
    const feedback = JSON.parse(fs.readFileSync("data/.n8n_feedback.json", "utf8"));
    const byKey = new Map();
    for (const f of feedback) {
        if (!byKey.has(f.message_key)) byKey.set(f.message_key, { key: f.message_key, proj: f.project_id, comments: [] });
        if (f.comments && !byKey.get(f.message_key).comments.includes(f.comments.trim())) byKey.get(f.message_key).comments.push(f.comments.trim());
    }
    fs.mkdirSync(FIX_DIR, { recursive: true });

    const token = await login();
    console.log(`login ok; ${byKey.size} unique messages`);

    let ok = 0, miss = 0, attOk = 0, attMiss = 0;
    for (const { key, proj, comments } of byKey.values()) {
        // try the stated project first, then the other
        let m = await getDetail(token, proj, key);
        let usedProj = proj;
        if (!m) { const other = PROJECTS.find((p) => p !== proj); m = await getDetail(token, other, key); usedProj = other; }
        if (!m) { console.log(`MISS ${key.slice(0, 8)}`); miss++; continue; }

        const attFiles = (m.attachmentFiles || m.attachments || []).map((a) => ({
            filename: a.filename || a.name || "", safeName: a.safeName || null,
            contentType: a.contentType || null, size: a.size || null,
        }));
        const fixture = {
            messageKey: key, projectId: usedProj, comments,
            subject: m.subject || "",
            body: m.body || m.analysis?.rawInput?.body || m.bodyPreview || "",
            attachmentFiles: attFiles,
            currentAnalysis: m.analysis || null,
        };
        fs.writeFileSync(path.join(FIX_DIR, `${key}.json`), JSON.stringify(fixture, null, 2));
        ok++;

        // download attachment bytes
        for (const a of attFiles) {
            if (!a.safeName) continue;
            const dir = path.join(ATT_ROOT, key);
            const dest = path.join(dir, a.safeName);
            if (fs.existsSync(dest) && fs.statSync(dest).size > 0) { attOk++; continue; }
            const buf = await download(token, key, a.safeName).catch(() => null);
            if (buf) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(dest, buf); attOk++; }
            else attMiss++;
        }
        console.log(`OK ${key.slice(0, 8)} [${usedProj.includes("4") ? "p4" : "p3"}] body=${fixture.body.length} att=${attFiles.length}`);
    }
    console.log(`\nfixtures: ${ok} ok, ${miss} miss | attachments: ${attOk} downloaded, ${attMiss} failed`);
}
main().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
