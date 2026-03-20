const API_BASE = "";

// ── Auth ──
function getToken() { return localStorage.getItem("manager_token"); }
function getUser() { try { return JSON.parse(localStorage.getItem("manager_user")); } catch { return null; } }

function setAuth(token, user) {
    localStorage.setItem("manager_token", token);
    localStorage.setItem("manager_user", JSON.stringify(user));
}

function clearAuth() {
    localStorage.removeItem("manager_token");
    localStorage.removeItem("manager_user");
}

async function login(loginVal, password) {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: loginVal, password })
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Ошибка авторизации");
    }
    const data = await res.json();
    setAuth(data.token, data.user);
    return data;
}

function logout() {
    clearAuth();
    showLogin();
}

async function fetchWithAuth(url, options = {}) {
    const token = getToken();
    if (!token) { logout(); return null; }
    const res = await fetch(url, {
        ...options,
        headers: { ...options.headers, Authorization: `Bearer ${token}` }
    });
    if (res.status === 401) { logout(); return null; }
    return res;
}

// ── Inbox ──
async function fetchInbox() {
    const res = await fetchWithAuth(`${API_BASE}/api/manager/inbox`);
    if (!res) return null;
    return res.json();
}

async function moderate(messageKey, verdict, comment = "", projectId = "") {
    if (verdict === "needs_rework" && !comment.trim()) {
        alert("Укажите, что необходимо доработать");
        return null;
    }
    const body = { verdict, comment };
    if (projectId) body.projectId = projectId;
    const res = await fetchWithAuth(`${API_BASE}/api/manager/moderate/${encodeURIComponent(messageKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
    if (!res) return null;
    return res.json();
}

// ── UI helpers ──
function $(id) { return document.getElementById(id); }

function showLogin() {
    $("login-section").style.display = "flex";
    $("inbox-section").style.display = "none";
    $("header-user").style.display = "none";
    $("login-error").textContent = "";
    $("login-input").value = "";
    $("password-input").value = "";
}

function showInbox() {
    $("login-section").style.display = "none";
    $("inbox-section").style.display = "block";
    $("header-user").style.display = "flex";
    const user = getUser();
    if (user) {
        $("user-name").textContent = user.fullName || user.login;
        $("user-role").textContent = user.role === "admin" ? "Администратор" : "Менеджер";
    }
    loadInbox();
}

function urgencyBadge(urgency) {
    const map = {
        urgent: { cls: "badge-urgent", label: "Срочно" },
        planned: { cls: "badge-planned", label: "Запланировано" },
        normal: { cls: "badge-normal", label: "Обычное" }
    };
    const u = map[urgency] || map.normal;
    return `<span class="mgr-badge ${u.cls}">${u.label}</span>`;
}

function statusBadge(status) {
    const map = {
        ready_for_crm: { cls: "badge-ready", label: "Готово к CRM" },
        needs_clarification: { cls: "badge-clarify", label: "Уточнение" },
        ignored_spam: { cls: "badge-spam", label: "Спам" },
        review: { cls: "badge-review", label: "На проверке" }
    };
    const s = map[status] || { cls: "badge-default", label: status || "—" };
    return `<span class="mgr-badge ${s.cls}">${s.label}</span>`;
}

function verdictBadge(verdict) {
    if (verdict === "approved") return `<span class="mgr-badge badge-approved">Одобрено</span>`;
    if (verdict === "needs_rework") return `<span class="mgr-badge badge-rework">На доработку</span>`;
    return "";
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderBadges(arr) {
    if (!arr || !arr.length) return `<span class="text-muted">—</span>`;
    return arr.map(b => `<span class="mgr-badge badge-tag">${escapeHtml(b)}</span>`).join(" ");
}

function renderAttachments(attachments) {
    if (!attachments || !attachments.length) return `<span class="text-muted">нет</span>`;
    return attachments.map(a => {
        const name = typeof a === "string" ? a : (a.filename || a.name || "файл");
        return `<span class="attachment-chip">${escapeHtml(name)}</span>`;
    }).join(" ");
}

// ── Render messages ──
function renderMessages(messages) {
    const container = $("messages-list");
    if (!messages || !messages.length) {
        container.innerHTML = `<div class="empty-state">Нет писем для модерации</div>`;
        return;
    }

    container.innerHTML = messages.map((msg, idx) => {
        const analysis = msg.analysis || msg;
        const key = msg.messageKey || msg.key || `msg-${idx}`;
        const subject = analysis.subject || msg.subject || "(без темы)";
        const from = analysis.fromEmail || msg.fromEmail || "";
        const company = analysis.companyName || msg.companyName || "";
        const brands = analysis.detectedBrands || [];
        const articles = analysis.articles || [];
        const productNames = analysis.productNames || [];
        const productTypes = analysis.detectedProductTypes || [];
        const urgency = analysis.urgency || "normal";
        const status = analysis.pipelineStatus || msg.pipelineStatus || "";
        const preview = (analysis.bodyPreview || analysis.body || "").slice(0, 200);
        const attachments = analysis.attachments || msg.attachments || [];
        const moderation = msg.moderation || null;
        const projectId = msg.projectId || "";

        const isModerated = moderation && moderation.verdict;

        let moderationHtml = "";
        if (isModerated) {
            moderationHtml = `
                <div class="moderation-result">
                    ${verdictBadge(moderation.verdict)}
                    ${moderation.comment ? `<span class="moderation-comment">${escapeHtml(moderation.comment)}</span>` : ""}
                    <span class="moderation-meta">${moderation.moderatorName || ""} ${moderation.at ? new Date(moderation.at).toLocaleString("ru-RU") : ""}</span>
                </div>`;
        } else {
            moderationHtml = `
                <div class="moderation-actions" id="mod-${idx}">
                    <button class="btn-approve" onclick="handleApprove('${escapeHtml(key)}', '${escapeHtml(projectId)}', ${idx})">Хорошо определил</button>
                    <button class="btn-rework" onclick="handleReworkToggle(${idx})">На доработку</button>
                    <div class="rework-form" id="rework-form-${idx}" style="display:none;">
                        <textarea id="rework-comment-${idx}" class="mgr-textarea" placeholder="Что нужно исправить..." rows="2"></textarea>
                        <div class="rework-validation" id="rework-error-${idx}"></div>
                        <button class="btn-send-rework" id="rework-send-${idx}" onclick="handleSendRework('${escapeHtml(key)}', '${escapeHtml(projectId)}', ${idx})">Отправить</button>
                    </div>
                </div>`;
        }

        return `
            <div class="message-card ${isModerated ? "moderated" : ""}">
                <div class="message-header">
                    <div class="message-subject">${escapeHtml(subject)}</div>
                    <div class="message-meta">
                        ${urgencyBadge(urgency)}
                        ${statusBadge(status)}
                    </div>
                </div>
                <div class="message-grid">
                    <div class="message-field">
                        <span class="field-label">От кого</span>
                        <span class="field-value">${escapeHtml(from)}${company ? ` <span class="company-name">(${escapeHtml(company)})</span>` : ""}</span>
                    </div>
                    <div class="message-field">
                        <span class="field-label">Бренды</span>
                        <span class="field-value">${renderBadges(brands)}</span>
                    </div>
                    <div class="message-field">
                        <span class="field-label">Артикулы</span>
                        <span class="field-value">${renderBadges(articles)}</span>
                    </div>
                    <div class="message-field">
                        <span class="field-label">Товары</span>
                        <span class="field-value">${renderBadges(productNames)}</span>
                    </div>
                    <div class="message-field">
                        <span class="field-label">Типы товаров</span>
                        <span class="field-value">${renderBadges(productTypes)}</span>
                    </div>
                    <div class="message-field">
                        <span class="field-label">Вложения</span>
                        <span class="field-value">${renderAttachments(attachments)}</span>
                    </div>
                </div>
                ${preview ? `<div class="message-preview">${escapeHtml(preview)}</div>` : ""}
                ${moderationHtml}
            </div>`;
    }).join("");
}

// ── Actions ──
async function handleApprove(messageKey, projectId, idx) {
    const mod = $(`mod-${idx}`);
    if (mod) mod.style.opacity = "0.5";
    const result = await moderate(messageKey, "approved", "", projectId);
    if (result) {
        loadInbox();
    } else if (mod) {
        mod.style.opacity = "1";
    }
}

function handleReworkToggle(idx) {
    const form = $(`rework-form-${idx}`);
    if (form) {
        const visible = form.style.display !== "none";
        form.style.display = visible ? "none" : "block";
        if (!visible) {
            const ta = $(`rework-comment-${idx}`);
            if (ta) ta.focus();
        }
    }
}

async function handleSendRework(messageKey, projectId, idx) {
    const comment = ($(`rework-comment-${idx}`) || {}).value || "";
    const errorEl = $(`rework-error-${idx}`);
    if (!comment.trim()) {
        if (errorEl) {
            errorEl.textContent = "Укажите, что необходимо доработать";
            errorEl.style.display = "block";
        }
        return;
    }
    if (errorEl) errorEl.style.display = "none";
    const btn = $(`rework-send-${idx}`);
    if (btn) { btn.disabled = true; btn.textContent = "Отправка..."; }
    const result = await moderate(messageKey, "needs_rework", comment, projectId);
    if (result) {
        loadInbox();
    } else if (btn) {
        btn.disabled = false;
        btn.textContent = "Отправить";
    }
}

async function loadInbox() {
    const container = $("messages-list");
    container.innerHTML = `<div class="loading-state">Загрузка...</div>`;
    try {
        const data = await fetchInbox();
        if (!data) return;
        $("inbox-total").textContent = `${data.total || 0} писем`;
        renderMessages(data.messages || []);
    } catch (err) {
        container.innerHTML = `<div class="error-state">Ошибка загрузки: ${escapeHtml(err.message)}</div>`;
    }
}

// ── Init ──
document.addEventListener("DOMContentLoaded", () => {
    // Login form
    $("login-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const loginVal = $("login-input").value.trim();
        const password = $("password-input").value;
        const errorEl = $("login-error");
        const btn = $("login-btn");
        errorEl.textContent = "";
        if (!loginVal || !password) {
            errorEl.textContent = "Введите логин и пароль";
            return;
        }
        btn.disabled = true;
        btn.textContent = "Вход...";
        try {
            await login(loginVal, password);
            showInbox();
        } catch (err) {
            errorEl.textContent = err.message;
        } finally {
            btn.disabled = false;
            btn.textContent = "Войти";
        }
    });

    // Logout
    $("logout-btn").addEventListener("click", logout);

    // Refresh
    $("refresh-btn").addEventListener("click", loadInbox);

    // Check existing auth
    const token = getToken();
    if (token) {
        // Verify token is still valid
        fetchWithAuth(`${API_BASE}/api/auth/me`).then(res => {
            if (res && res.ok) {
                showInbox();
            } else {
                showLogin();
            }
        }).catch(() => showLogin());
    } else {
        showLogin();
    }
});
