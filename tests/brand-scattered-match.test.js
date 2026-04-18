import assert from "node:assert/strict";
import { analyzeEmail } from "../src/services/email-analyzer.js";

// Regression tests for ghost-brand audit (1753 emails, 904 with ghost brands).
// Covers two root causes in matchesBrand():
//   Bug 1 — scattered word match: "Power Innovation" matching "Power rating" + "innovation lab".
//   Bug 2 — alias substring match: "DIGI" matching inside "Digital", "ITAL" inside "Digital",
//           "Robot" inside "robot-mail-siderus".

const project = {
    mailbox: "inbox@example.com",
    brands: [
        "Power Innovation",
        "Power Integrations",
        "DIGI",
        "ITAL Technology",
        "Fisher",
        "Robot Pumps",
        "Россия"
    ],
    managerPool: { defaultMop: "Ольга", defaultMoz: "Андрей", brandOwners: [] },
    knownCompanies: []
};

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

runTest("does not match 'Power Innovation' on scattered Power/innovation words", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "CHALMIT LIGHTING LTD inquiry",
        attachments: "",
        body: `
            Dear Sirs,

            Please quote CHALMIT LIGHTING LTD fittings.
            Power rating 250 W AND 400 W required.

            Regards,
            innovation lab at some other company
        `
    });

    assert.ok(!analysis.lead.detectedBrands.includes("Power Innovation"),
        `Expected no 'Power Innovation' ghost match, got: ${JSON.stringify(analysis.lead.detectedBrands)}`);
    assert.ok(!analysis.lead.detectedBrands.includes("Power Integrations"),
        `Expected no 'Power Integrations' ghost match, got: ${JSON.stringify(analysis.lead.detectedBrands)}`);
});

runTest("does not match 'DIGI' or 'ITAL Technology' on substring of 'Digital'", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "Fisher FIELDVUE request",
        attachments: "",
        body: `
            Добрый день.
            Нужна цена на Fisher FIELDVUE Digital Valve Controllers.
            Quartz QX от Stonel.
        `
    });

    assert.ok(!analysis.lead.detectedBrands.includes("DIGI"),
        `Expected no 'DIGI' substring match, got: ${JSON.stringify(analysis.lead.detectedBrands)}`);
    assert.ok(!analysis.lead.detectedBrands.includes("ITAL Technology"),
        `Expected no 'ITAL Technology' substring match, got: ${JSON.stringify(analysis.lead.detectedBrands)}`);
});

runTest("does not match 'Россия' brand on postal address text", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Иван",
        fromEmail: "ivan@example.ru",
        subject: "Заявка",
        attachments: "",
        body: `
            Добрый день.
            Просим выставить КП по артикулу ABC-123 x 5 шт.
            ---
            123610, Россия, Москва, Краснопресненская наб. 12.
        `
    });

    assert.ok(!analysis.lead.detectedBrands.includes("Россия"),
        `Expected no 'Россия' address-noise match, got: ${JSON.stringify(analysis.lead.detectedBrands)}`);
});

runTest("does not match 'Robot Pumps' on mailbox string robot-mail-siderus", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Forwarder",
        fromEmail: "robot-mail-siderus@klvrt.ru",
        subject: "ROSSI RCI 250",
        attachments: "",
        body: `
            Пересылка заявки.
            Нужен ROSSI RCI 250 x 2 шт.
        `
    });

    assert.ok(!analysis.lead.detectedBrands.includes("Robot Pumps"),
        `Expected no 'Robot Pumps' mailbox-substring match, got: ${JSON.stringify(analysis.lead.detectedBrands)}`);
});

runTest("still detects 'Fisher' via word boundary (positive regression)", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "Fisher FIELDVUE request",
        attachments: "",
        body: `
            Добрый день.
            Нужна цена на Fisher FIELDVUE Digital Valve Controllers.
        `
    });

    assert.ok(analysis.lead.detectedBrands.includes("Fisher"),
        `Expected 'Fisher' to be detected, got: ${JSON.stringify(analysis.lead.detectedBrands)}`);
});
