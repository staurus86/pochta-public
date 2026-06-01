import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeCompanyName } from "../src/services/email-analyzer.js";

// P3 — registration-tail typo variant: «Наименование организациЯ» (vs the hardcoded «организацИИ»).
test("P3: reg-tail с «организациЯ» отрезается", () => {
    assert.equal(sanitizeCompanyName('ООО "Тестори" Наименование организация'), 'ООО "Тестори"');
    // existing «организации» still works
    assert.equal(sanitizeCompanyName("ООО «ЛАБОРАТОРИЯ-КИП» Полное наименование организации ОБЩ"), "ООО «ЛАБОРАТОРИЯ-КИП»");
});

// P4 — Latin "Person Role of Company LLC" blob (manager 4fc194fe): keep only the company tail.
test("P4: Latin person-role-of-company → только компания", () => {
    assert.equal(
        sanitizeCompanyName("Anna Zimmermann Procurement manager of ITER PPTF Project LLC"),
        "ITER PPTF Project LLC"
    );
});

test("P4: реальные компании с 'of' без роли НЕ затрагиваются", () => {
    assert.equal(sanitizeCompanyName("Bank of America"), "Bank of America");
    assert.equal(sanitizeCompanyName("ООО «ПроВоздух»"), "ООО «ПроВоздух»");
});
