import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { ProjectsStore } from "../src/storage/projects-store.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

describe("Manager Moderation", () => {
    const testDir = path.resolve("data/test-moderation-" + Date.now());
    let store;

    before(async () => {
        mkdirSync(testDir, { recursive: true });
        writeFileSync(path.join(testDir, "projects.json"), JSON.stringify([
            {
                id: "test-project",
                type: "email-parser",
                name: "Test",
                recentMessages: [
                    {
                        messageKey: "msg-1",
                        subject: "Test email",
                        pipelineStatus: "ready_for_crm",
                        analysis: { classification: { label: "client" }, detectedBrands: ["ABB"] }
                    },
                    {
                        messageKey: "msg-2",
                        subject: "Another email",
                        pipelineStatus: "review",
                        analysis: { classification: { label: "client" } }
                    }
                ]
            }
        ]));
        store = new ProjectsStore({ dataDir: testDir });
    });

    after(() => {
        try { rmSync(testDir, { recursive: true, force: true }); } catch {}
    });

    test("applyMessageFeedback with approved verdict sets ready_for_crm", async () => {
        const result = await store.applyMessageFeedback("test-project", "msg-2", {
            moderationVerdict: "approved",
            moderationComment: "",
            moderatedBy: "Тест Менеджер"
        });
        assert.ok(result);
        assert.ok(result.changes.includes("moderation:approved"));
        // Verify message status changed
        const project = await store.getProject("test-project");
        const msg = project.recentMessages.find((m) => m.messageKey === "msg-2");
        assert.strictEqual(msg.pipelineStatus, "ready_for_crm");
        assert.strictEqual(msg.moderationVerdict, "approved");
        assert.strictEqual(msg.moderatedBy, "Тест Менеджер");
    });

    test("applyMessageFeedback with needs_rework verdict sets review", async () => {
        const result = await store.applyMessageFeedback("test-project", "msg-1", {
            moderationVerdict: "needs_rework",
            moderationComment: "Неправильно определён бренд",
            moderatedBy: "Тест Менеджер"
        });
        assert.ok(result);
        assert.ok(result.changes.includes("moderation:needs_rework"));
        const project = await store.getProject("test-project");
        const msg = project.recentMessages.find((m) => m.messageKey === "msg-1");
        assert.strictEqual(msg.pipelineStatus, "review");
        assert.strictEqual(msg.moderationComment, "Неправильно определён бренд");
    });

    test("moderation records audit log entries", async () => {
        const project = await store.getProject("test-project");
        const msg = project.recentMessages.find((m) => m.messageKey === "msg-1");
        assert.ok(msg.auditLog.length > 0);
        const moderationEntry = msg.auditLog.find((e) => e.changes?.some((c) => c.startsWith("moderation:")));
        assert.ok(moderationEntry);
    });
});
