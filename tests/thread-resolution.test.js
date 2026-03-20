import assert from "node:assert/strict";

// Inline thread resolution for testing (same logic as project3-runner.js)
function resolveThreadIds(messages) {
  const messageIdToThread = new Map();
  let nextThreadNum = 1;

  for (const msg of messages) {
    if (msg.threadId) continue;
    const msgId = (msg.emailMessageId || "").trim();
    const inReplyTo = (msg.inReplyTo || "").trim();
    const refs = (msg.references || "").trim().split(/\s+/).filter(Boolean);

    let threadId = null;
    if (inReplyTo && messageIdToThread.has(inReplyTo)) {
      threadId = messageIdToThread.get(inReplyTo);
    }
    if (!threadId) {
      for (const ref of refs) {
        if (messageIdToThread.has(ref)) { threadId = messageIdToThread.get(ref); break; }
      }
    }
    if (!threadId) threadId = `thread-${nextThreadNum++}`;

    msg.threadId = threadId;
    if (msgId) messageIdToThread.set(msgId, threadId);
    for (const ref of refs) {
      if (!messageIdToThread.has(ref)) messageIdToThread.set(ref, threadId);
    }
  }
}

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

runTest("groups messages by In-Reply-To header", () => {
  const msgs = [
    { subject: "Request for ABB", emailMessageId: "<msg1@example.com>", inReplyTo: "", references: "" },
    { subject: "Re: Request for ABB", emailMessageId: "<msg2@example.com>", inReplyTo: "<msg1@example.com>", references: "<msg1@example.com>" },
    { subject: "Re: Re: Request for ABB", emailMessageId: "<msg3@example.com>", inReplyTo: "<msg2@example.com>", references: "<msg1@example.com> <msg2@example.com>" }
  ];

  resolveThreadIds(msgs);

  assert.equal(msgs[0].threadId, msgs[1].threadId, "Reply should be in same thread as original");
  assert.equal(msgs[1].threadId, msgs[2].threadId, "Nested reply should be in same thread");
});

runTest("creates separate threads for unrelated messages", () => {
  const msgs = [
    { subject: "Order ABB", emailMessageId: "<a@example.com>", inReplyTo: "", references: "" },
    { subject: "Invoice Siemens", emailMessageId: "<b@example.com>", inReplyTo: "", references: "" }
  ];

  resolveThreadIds(msgs);

  assert.notEqual(msgs[0].threadId, msgs[1].threadId, "Unrelated messages should be in different threads");
});

runTest("links messages by References header when In-Reply-To is missing", () => {
  const msgs = [
    { subject: "Заявка", emailMessageId: "<root@corp.ru>", inReplyTo: "", references: "" },
    { subject: "Re: Заявка", emailMessageId: "<reply@corp.ru>", inReplyTo: "", references: "<root@corp.ru>" }
  ];

  resolveThreadIds(msgs);

  assert.equal(msgs[0].threadId, msgs[1].threadId, "References should link to same thread");
});

runTest("preserves existing threadId", () => {
  const msgs = [
    { subject: "Test", emailMessageId: "<x@y.com>", threadId: "existing-thread" }
  ];

  resolveThreadIds(msgs);

  assert.equal(msgs[0].threadId, "existing-thread");
});
