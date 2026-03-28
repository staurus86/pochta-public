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

await runTest("marks reply without new signal in same thread as ignored_duplicate", async () => {
  const threadedProject = {
    ...project,
    recentMessages: [
      {
        id: "message-root",
        messageKey: "msg-root",
        createdAt: "2026-03-18T10:00:00.000Z",
        subject: "Запрос на ABB",
        from: "buyer@factory.ru",
        bodyPreview: "Прошу КП на ABB S201-C16 - 2 шт",
        attachments: [],
        pipelineStatus: "ready_for_crm",
        threadId: "thread-10",
        analysis: {
          classification: { label: "Клиент", confidence: 0.92 },
          sender: { email: "buyer@factory.ru" },
          lead: { articles: ["S201-C16"], lineItems: [{ article: "S201-C16", descriptionRu: "ABB S201-C16", quantity: 2, unit: "шт" }] },
          crm: {}
        },
        auditLog: []
      },
      {
        id: "message-reply",
        messageKey: "msg-reply",
        createdAt: "2026-03-18T10:05:00.000Z",
        subject: "Re: Запрос на ABB",
        from: "buyer@factory.ru",
        bodyPreview: "Спасибо, получили",
        attachments: [],
        pipelineStatus: "ready_for_crm",
        threadId: "thread-10",
        inReplyTo: "<root@factory.ru>",
        analysis: {
          classification: { label: "Клиент", confidence: 0.8 },
          sender: { email: "buyer@factory.ru" },
          lead: { articles: [], lineItems: [] },
          crm: {}
        },
        auditLog: []
      }
    ]
  };

  const result = await reprocessMailboxMessages(threadedProject, {
    limit: 10,
    preserveStatus: false
  });

  const reply = result.recentMessages.find((item) => item.messageKey === "msg-reply");
  assert.equal(reply.pipelineStatus, "ignored_duplicate");
  assert.equal(reply.analysis.threadDedup?.isDuplicateReply, true);
  assert.equal(reply.analysis.threadDedup?.reason, "reply_without_new_signal");
});

await runTest("keeps reply with new article in same thread as actionable request", async () => {
  const threadedProject = {
    ...project,
    recentMessages: [
      {
        id: "message-root-2",
        messageKey: "msg-root-2",
        createdAt: "2026-03-18T10:00:00.000Z",
        subject: "Запрос на ABB",
        from: "buyer@factory.ru",
        bodyPreview: "Прошу КП на ABB S201-C16 - 2 шт",
        attachments: [],
        pipelineStatus: "ready_for_crm",
        threadId: "thread-20",
        analysis: {
          classification: { label: "Клиент", confidence: 0.92 },
          sender: { email: "buyer@factory.ru" },
          lead: { articles: ["S201-C16"], lineItems: [{ article: "S201-C16", descriptionRu: "ABB S201-C16", quantity: 2, unit: "шт" }] },
          crm: {}
        },
        auditLog: []
      },
      {
        id: "message-reply-2",
        messageKey: "msg-reply-2",
        createdAt: "2026-03-18T10:06:00.000Z",
        subject: "Re: Запрос на ABB",
        from: "buyer@factory.ru",
        bodyPreview: "Добавьте еще позицию ABB S201-C25 - 1 шт",
        attachments: [],
        pipelineStatus: "ready_for_crm",
        threadId: "thread-20",
        inReplyTo: "<root2@factory.ru>",
        analysis: {
          classification: { label: "Клиент", confidence: 0.85 },
          sender: { email: "buyer@factory.ru" },
          lead: { articles: [], lineItems: [] },
          crm: {}
        },
        auditLog: []
      }
    ]
  };

  const result = await reprocessMailboxMessages(threadedProject, {
    limit: 10,
    preserveStatus: false
  });

  const reply = result.recentMessages.find((item) => item.messageKey === "msg-reply-2");
  assert.notEqual(reply.pipelineStatus, "ignored_duplicate");
  assert.equal(reply.analysis.threadDedup, undefined);
  assert.ok(reply.analysis.lead.articles.includes("S201-C25"));
});
