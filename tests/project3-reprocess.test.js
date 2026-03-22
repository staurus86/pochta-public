import assert from "node:assert/strict";
import { reprocessMailboxMessages } from "../src/services/project3-runner.js";

const project = {
  id: "project-3-mailbox-file",
  type: "mailbox-file-parser",
  mailbox: "multi-mailbox@project3.local",
  brands: ["ABB", "Endress & Hauser"],
  managerPool: {
    defaultMop: "Не назначен",
    defaultMoz: "Не назначен",
    brandOwners: []
  },
  knownCompanies: [],
  recentMessages: [
    {
      id: "message-1",
      messageKey: "msg-1",
      createdAt: "2026-03-18T10:00:00.000Z",
      subject: "Отправка заявки с сайта Endress - Hauser",
      from: "WordPress <wordpress@endress-hauser.pro>",
      bodyPreview: "<b>Заявка с формы обратной связи</b> <p>Имя: тест5</p><p>Телефон: +7 (899) 999-99-99</p><p>Артикул A9N18346 x 2 шт</p>",
      attachments: [],
      pipelineStatus: "ready_for_crm",
      analysis: {
        detectedBrands: ["Endress & Hauser"],
        sender: {
          email: "wordpress@endress-hauser.pro",
          mobilePhone: "+7 (899) 999-99-99"
        },
        lead: {
          articles: ["999-99", "A9N18346"]
        }
      },
      auditLog: []
    }
  ]
};

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

await runTest("reprocesses saved mailbox messages and removes stale phone fragments", async () => {
  const result = await reprocessMailboxMessages(project, {
    limit: 10,
    preserveStatus: true,
    batchSize: 10
  });

  assert.equal(result.status, "ok");
  assert.equal(result.reprocessed, 1);
  assert.equal(result.changed, 1);
  assert.equal(result.statusChanged, 0);
  assert.equal(result.batchSize, 10);
  assert.ok(result.telemetry);
  assert.equal(result.telemetry.processed, 1);
  assert.equal(result.recentMessages[0].pipelineStatus, "ready_for_crm");
  assert.ok(result.recentMessages[0].analysis.lead.articles.includes("A9N18346"));
  assert.ok(!result.recentMessages[0].analysis.lead.articles.includes("999-99"));
  assert.equal(result.recentMessages[0].auditLog.at(-1).action, "reprocess");
});

await runTest("can recompute pipeline status when preserveStatus is disabled", async () => {
  const spamProject = {
    ...project,
    recentMessages: [
      {
        ...project.recentMessages[0],
        messageKey: "msg-2",
        subject: "Sale",
        bodyPreview: "Распродажа, unsubscribe, скидка до 70%",
        pipelineStatus: "ready_for_crm",
        analysis: {
          detectedBrands: [],
          sender: {},
          lead: { articles: [] }
        }
      }
    ]
  };

  const result = await reprocessMailboxMessages(spamProject, {
    limit: 10,
    preserveStatus: false
  });

  assert.equal(result.recentMessages[0].pipelineStatus, "ignored_spam");
  assert.equal(result.statusChanged, 1);
});
