const ENABLED_ROLES = new Set(["all", "api", "scheduler", "webhooks", "background", "none"]);

export function normalizeBackgroundRole(value) {
  const role = String(value || "all").trim().toLowerCase();
  if (!role) {
    return "all";
  }

  return ENABLED_ROLES.has(role) ? role : "all";
}

export function shouldRunScheduler(role) {
  const normalized = normalizeBackgroundRole(role);
  return normalized === "all" || normalized === "scheduler" || normalized === "background";
}

export function shouldRunWebhooks(role) {
  const normalized = normalizeBackgroundRole(role);
  return normalized === "all" || normalized === "webhooks" || normalized === "background";
}
