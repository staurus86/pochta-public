// Start a full rules-based reanalysis on prod for both projects, then poll to completion.
// POST /api/projects/:id/reanalyze (background job) → GET /api/projects/:id/job/:jid.
const BASE = "https://pochta-production.up.railway.app";
const PW = "LgxaZ@ZDgNBXgSpnmTHEW6MC";
const PROJECTS = ["project-3-mailbox-file", "project-4-klvrt-mail"];

async function api(method, path, token, body) {
    const r = await fetch(BASE + path, {
        method,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60000),
    });
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 300) }; }
    return { status: r.status, j };
}

const { j: login } = await api("POST", "/api/auth/login", null, { login: "admin", password: PW });
const token = login.token;
console.log("login:", token ? "ok" : JSON.stringify(login));

const jobs = [];
for (const pid of PROJECTS) {
    await api("DELETE", `/api/projects/${pid}/reanalyze`, token);
    const { status, j } = await api("POST", `/api/projects/${pid}/reanalyze`, token, {});
    const jid = j?.job?.id || j?.jobId || j?.id;
    console.log(`[${pid}] start reanalyze HTTP ${status} jobId=${jid}`, jid ? "" : JSON.stringify(j));
    if (jid) jobs.push([pid, jid]);
}

if (!jobs.length) { console.log("no jobs started"); process.exit(1); }

while (true) {
    let allDone = true;
    const lines = [];
    for (const [pid, jid] of jobs) {
        const { j } = await api("GET", `/api/projects/${pid}/job/${jid}`, token);
        const job = j?.job || {};
        const p = job.progress || {};
        lines.push(`${pid.slice(0, 22).padEnd(22)} ${String(job.status).padEnd(9)} ${p.processed || 0}/${p.total || 0} err=${p.errors || 0} skip=${p.skipped || 0}`);
        if (job.status === "running" || job.status === "pending") allDone = false;
    }
    console.log(`[${new Date().toISOString().slice(11, 19)}] ` + lines.join(" | "));
    if (allDone) { console.log("ALL DONE"); break; }
    await new Promise((r) => setTimeout(r, 12000));
}
