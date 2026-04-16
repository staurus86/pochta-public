/**
 * LLM Cache — persistent store for LLM extraction results.
 *
 * Writes to data/llm-cache.json keyed by messageKey.
 * Never erased by reanalysis. Used to restore llmExtraction
 * if it gets overwritten.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.resolve(__dir, "../../data/llm-cache.json");

let _cache = null;

function load() {
    if (_cache) return _cache;
    try {
        _cache = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    } catch {
        _cache = {};
    }
    return _cache;
}

function save() {
    try {
        writeFileSync(CACHE_FILE, JSON.stringify(_cache, null, 2), "utf8");
    } catch (err) {
        console.warn("llm-cache: failed to save:", err.message);
    }
}

/**
 * Write LLM result for a message. Overwrites previous entry for same key.
 */
export function writeLlmCache(messageKey, entry) {
    if (!messageKey) return;
    const cache = load();
    cache[messageKey] = entry;
    save();
}

/**
 * Read cached LLM result. Returns null if not found.
 */
export function readLlmCache(messageKey) {
    if (!messageKey) return null;
    return load()[messageKey] ?? null;
}

/**
 * Return all cached entries as an array sorted by processedAt desc.
 */
export function getAllLlmCache() {
    const cache = load();
    return Object.entries(cache)
        .map(([key, val]) => ({ messageKey: key, ...val }))
        .sort((a, b) => (b.processedAt || "").localeCompare(a.processedAt || ""));
}
