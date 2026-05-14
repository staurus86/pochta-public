import https from "node:https";

const VERIFICATION_MAP = {
    "есть замечания": "needs_rework",
    "принято": "approved",
    "ok": "approved",
    "ок": "approved"
};

const insecureAgent = new https.Agent({ rejectUnauthorized: false });

export async function fetchValidationFeedback(webhookUrl, authHeader) {
    const parsed = new URL(webhookUrl);
    const body = await new Promise((resolve, reject) => {
        const req = https.request(
            {
                hostname: parsed.hostname,
                port: parsed.port || 443,
                path: parsed.pathname + parsed.search,
                method: "GET",
                headers: { Authorization: authHeader },
                agent: insecureAgent,
                timeout: 15_000
            },
            (res) => {
                const chunks = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () => {
                    if (res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode}`));
                    } else {
                        resolve(Buffer.concat(chunks).toString("utf-8"));
                    }
                });
            }
        );
        req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")); });
        req.on("error", reject);
        req.end();
    });

    const data = JSON.parse(body);
    return Array.isArray(data) ? data : [data];
}

export function normalizeValidationRecord(record) {
    const verification = String(record.verification || "").trim().toLowerCase();
    const comments = String(record.comments || "").trim();
    const verdictKey = Object.keys(VERIFICATION_MAP).find((k) => verification.includes(k));
    return {
        messageKey: String(record.message_key || "").trim(),
        projectId: String(record.project_id || "").trim(),
        verificationRaw: String(record.verification || "").trim(),
        verdict: verdictKey ? VERIFICATION_MAP[verdictKey] : null,
        comments: comments || null,
        reviewed: Boolean(verification)
    };
}

export async function applyValidationFeedbackToStore(store, records) {
    const results = [];
    for (const rec of records) {
        if (!rec.messageKey || !rec.projectId || !rec.reviewed) {
            results.push({ ...rec, applied: false, reason: "not_reviewed" });
            continue;
        }

        const project = await store.getProject(rec.projectId);
        if (!project) {
            results.push({ ...rec, applied: false, reason: "project_not_found" });
            continue;
        }

        const msg = (project.recentMessages || []).find(
            (m) => (m.messageKey || m.id) === rec.messageKey
        );
        if (!msg) {
            results.push({ ...rec, applied: false, reason: "message_not_found" });
            continue;
        }

        const now = new Date().toISOString();
        const previous = msg.managerValidation || null;

        msg.managerValidation = {
            verificationRaw: rec.verificationRaw,
            verdict: rec.verdict,
            comments: rec.comments,
            syncedAt: now,
            previousVerdict: previous?.verdict || null
        };

        if (!msg.auditLog) msg.auditLog = [];
        msg.auditLog.push({
            action: "manager_validation_sync",
            at: now,
            changes: [`verdict:${rec.verdict || "none"}`, rec.comments ? `comment:set` : null].filter(Boolean),
            fields: { verification: rec.verificationRaw, comments: rec.comments }
        });

        results.push({ ...rec, applied: true, reason: "ok" });
    }

    await store.persist();
    return results;
}

export function buildValidationStats(results) {
    const total = results.length;
    const applied = results.filter((r) => r.applied).length;
    const skipped = results.filter((r) => !r.applied).length;
    const byVerdict = {};
    const byReason = {};

    for (const r of results) {
        const v = r.verdict || (r.reviewed ? "unknown" : "not_reviewed");
        byVerdict[v] = (byVerdict[v] || 0) + 1;
        byReason[r.reason] = (byReason[r.reason] || 0) + 1;
    }

    return { total, applied, skipped, byVerdict, byReason };
}
