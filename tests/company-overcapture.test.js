import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeCompanyName } from "../src/services/email-analyzer.js";

// Manager ground-truth (4fc194fe-adjacent): companyName overcaptures a trailing signature
// tail — a job title ("ООО «ПРОФСТРОЙ» Директор Трубников…") or a registration phrase
// ("ООО «НК Сервис» Зарегистрировано в ИФНС…"). The existing role-tail strip lacked
// "директор"; registration phrases were not stripped at all. Corpus: 9 msgs, 0 breaks.

test("company-overcapture: trailing role 'Директор …' отрезается", () => {
    assert.equal(
        sanitizeCompanyName("ООО «ПРОФСТРОЙ» Директор Трубников Евгений Сергеевич"),
        "ООО «ПРОФСТРОЙ»"
    );
    assert.equal(
        sanitizeCompanyName("ООО «ПСИ» Директор (действующий на основании Устава) Чингарев Алексей Викторович т."),
        "ООО «ПСИ»"
    );
});

test("company-overcapture: регистрационный хвост отрезается", () => {
    assert.equal(
        sanitizeCompanyName("ООО «НК Сервис» Зарегистрировано в Межрайонной ИФНС России №1 по Московской области"),
        "ООО «НК Сервис»"
    );
    assert.equal(
        sanitizeCompanyName("АО «НЭВЗ-КЕРАМИКС» Сокращенное наименование АО «НЭВЗ-КЕРАМИКС»"),
        "АО «НЭВЗ-КЕРАМИКС»"
    );
    assert.equal(
        sanitizeCompanyName("ООО «ЛЛК-Интернешнл» Полное наименование организации в соответствии с учреди"),
        "ООО «ЛЛК-Интернешнл»"
    );
});

test("company-overcapture: роль-слово ВНУТРИ названия не ломает компанию", () => {
    // "технологии"/"снабжение" are common company-name words — must NOT be stripped.
    assert.equal(sanitizeCompanyName('ГК "Новые технологии"'), 'ГК "Новые технологии"');
    assert.equal(sanitizeCompanyName("ООО «КОМПЛЕКСНОЕ СНАБЖЕНИЕ»"), "ООО «КОМПЛЕКСНОЕ СНАБЖЕНИЕ»");
});
