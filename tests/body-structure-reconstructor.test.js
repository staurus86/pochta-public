// body-structure-reconstructor.test.js
// TDD suite for manager-feedback clusters (n8n, 52 commented emails):
//   R-1 vertical table:   name / qty / unit [/ code] groups (flattened HTML tables)
//   R-2 collapsed table:  "Наименование Ед. изм. Кол-во 1 ... ШТ 1 2 ..." single-line blobs
//   R-3 numbered list:    "N) Name (Brand) CODE ... В количестве N штук" segments
// Real bodies from prod feedback fixtures (keys in comments).

import { test } from "node:test";
import assert from "node:assert/strict";

import { reconstructBodyPositions } from "../src/services/body-structure-reconstructor.js";

// ─────────────────────────────────────────────────────────────────────────────
// R-1 vertical table — name line, qty line, unit line (0d3312eb, Уралмаш)
// ─────────────────────────────────────────────────────────────────────────────

test("R-1: name/qty/unit groups → 3 rows with per-row qty", () => {
    const body = [
        "Добрый день.",
        "Прошу рассмотреть возможность поставки следующей продукции:",
        "(аналоги рассматриваются при наличии описания)",
        "Клапан электромагнитный двухходовой 21HT4K0Y160 ODE",
        "",
        "3",
        "",
        "шт",
        "",
        "Привод пневматический 82DA0007 DA32 Valbia",
        "",
        "4",
        "",
        "шт",
        "",
        "Клапан NM52W1S-PR-IL Vesta",
        "",
        "4",
        "",
        "шт",
        "",
        "При положительном решении направить в наш адрес счет.",
    ].join("\n");
    const result = reconstructBodyPositions(body);
    assert.ok(result, "expected reconstruction to fire");
    assert.equal(result.kind, "vertical_table");
    assert.equal(result.rows.length, 3);
    assert.deepEqual(result.rows.map((r) => r.quantity), [3, 4, 4]);
    assert.equal(result.rows[0].unit, "шт");
    assert.match(result.rows[0].descriptionRu, /Клапан электромагнитный/);
});

// R-1 variant with standalone code line + catalog footnotes (3957aeea, Сегозерская МГЭС)
test("R-1: name/qty/unit/code groups with footnotes → 7 rows, code = article", () => {
    const rows = [
        ["Манжета уплотнения вала Walkersele M11/D8 370x414x20", 4, "Ж00600020002"],
        ["Манжета уплотнения подшипникового узла Walkersele M11/D8 430x480x22", 2, "Ж00600030002"],
        ["Манжета верхнего подшипника направляющего аппарата Merkel T20 110-130-11.8", 4, "Ж00600040002"],
        ["Манжета нижнего подшипника направляющего аппарата Merkel T20 70-85-10", 2, "Ж00600050002"],
        ["Цанга Ч. MAV 1062 75x115", 2, "Ж00600060002"],
        ["Цанга Clampex KTR100 200x260", 2, "Ж00600070002"],
        ["Наконечники SKF KMT-7 M35x1,5", 8, "Ж00600080002"],
    ];
    const body = "Прошу рассмотреть возможность поставки манжет, цанг и наконечников\n\n"
        + rows.map(([name, qty, code]) =>
            `${name}\n\n${qty}\n\nшт.\n\n${code}\n\nКаталог «Walkersele_radial_lip_seals» информация о материале страница – стр. №12\n`
        ).join("\n")
        + "\nС уважением,\nОльга Ярославовна Франковская";
    const result = reconstructBodyPositions(body);
    assert.ok(result, "expected reconstruction to fire");
    assert.equal(result.rows.length, 7);
    assert.deepEqual(result.rows.map((r) => r.article), rows.map(([, , code]) => code));
    assert.deepEqual(result.rows.map((r) => r.quantity), rows.map(([, q]) => q));
});

// R-1 variant: index / name / unit / qty (568fb6dc, Wampfler; d88cb2ed, Eaton)
test("R-1: index/name/unit/qty groups with decimal qty → indices stripped", () => {
    const body = [
        "Просьба направить КП на продукцию:",
        "№", "Наименование", "Ед. изм", "Кол-во",
        "1",
        "Рукав высокого давления гидравлический полимер 31,8х42 МПа Eaton AEROQUIP R15 GH466-20",
        "м",
        "2,4",
        "2",
        "Гидравлический шланг Eaton Aeroquip GH681-16",
        "м",
        "3,8",
        "3",
        "Гидравлический шланг Eaton Aeroquip GH681-20",
        "м",
        "1,2",
        "С уважением, Максим",
    ].join("\n\n");
    const result = reconstructBodyPositions(body);
    assert.ok(result, "expected reconstruction to fire");
    assert.equal(result.rows.length, 3);
    assert.deepEqual(result.rows.map((r) => r.quantity), [2.4, 3.8, 1.2]);
    assert.equal(result.rows[0].unit, "м");
    assert.match(result.rows[1].descriptionRu, /GH681-16/);
});

// R-1 single row accepted when name carries an article-like token (443970c3, Волжский Оргсинтез)
test("R-1: single name/qty/unit group with article in name → 1 row", () => {
    const body = [
        "Добрый день! Компания АО Волжский Оргсинтез просит рассмотреть возможность поставки оборудования:",
        "Ремонтный комплект для проточной арматуры Flowfit CUA252 анализатора мутности Turbimax CUS52D Endress+Hauser Швейцария.",
        "",
        "3",
        "",
        "Компл",
        "",
        "С уважением, Розинский Ефим",
    ].join("\n");
    const result = reconstructBodyPositions(body);
    assert.ok(result, "expected reconstruction to fire");
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].quantity, 3);
    assert.match(result.rows[0].unit, /компл/i);
});

// R-1 must NOT fire on a plain letter without tabular qty groups
test("R-1: plain prose body → null", () => {
    const body = [
        "Добрый день!",
        "Прошу выставить счёт на электродвигатель ELCO BTNB41TB0353S.",
        "Срок поставки укажите в КП.",
        "С уважением, Иванов Иван",
        "тел. +7 912 345-67-89",
    ].join("\n");
    assert.equal(reconstructBodyPositions(body), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// R-2 collapsed single-line table (11d1b010, Техсервис-МП — 25 позиций)
// ─────────────────────────────────────────────────────────────────────────────

test("R-2: collapsed 'Наименование Ед. изм. Кол-во 1 ... ШТ 1 2 ...' blob → sequential rows", () => {
    const body = "добрый день!\nпрошу вас дать предложение на комплектующие из списка:\n\n"
        + "Наименование Ед. изм. Кол-во 1 Колесо рабочее Pedrollo F40/160A 866GRF4116 ШТ 1 "
        + "2 Колесо рабочее Varisco JE2-10 / JE2-100 G10ET20/10005251 ШТ 2 "
        + "3 Корпус (кожух) насоса Varisco JE2-100, Артикул № 1000 8027 ШТ 1 "
        + "4 Насос высокого давления MО 37 D сер. номер 950946 ШТ 1 "
        + "5 Генератор розжига ZT 870 ШТ 4 "
        + "6 Манжета армированная 1.1-30х52-3 ШТ 1 "
        + "7 Ремень клиновой SL998/ROFLEX XPZ 1700/3V КОМПЛ 4 "
        + "8 Ремень Optibelt SK SPB 2180 ШТ 4\n\n--\nС уважением,\nПлатонова Ольга";
    const result = reconstructBodyPositions(body);
    assert.ok(result, "expected reconstruction to fire");
    assert.equal(result.kind, "collapsed_table");
    assert.equal(result.rows.length, 8);
    assert.deepEqual(result.rows.map((r) => r.quantity), [1, 2, 1, 1, 4, 1, 4, 4]);
    assert.match(result.rows[0].descriptionRu, /Колесо рабочее Pedrollo/);
    assert.match(result.rows[6].unit, /компл/i);
});

// ─────────────────────────────────────────────────────────────────────────────
// R-3 numbered list with "В количестве N штук" (25a983a0, Waldner — 5 позиций)
// ─────────────────────────────────────────────────────────────────────────────

test("R-3: numbered (Brand) CODE list with 'В количестве N штук' → 5 rows", () => {
    const body = [
        "Добрый день",
        "",
        "Прошу рассмотреть возможность поставки :",
        "",
        "1) Кольцо с канавкой (Waldner) 42201728 nutring s=2.5 aun16-40 groove ",
        "ring, для фасовочного автомата. В количестве 30 штук.",
        "2) Чексил (Waldner) 42206755 chekseal 55*95 для фасовочного ",
        "автомата. В количестве 6 штук.",
        "3) Круглое крепление (Waldner) 70103107 Rund-einh schnellk round bar ",
        "quick release для фасовочного автомата. В количестве 4 штук.",
        "4) Уплотнение (Waldner) 91649736 nutring stangendicichtend du52 ",
        "grooving seal для фасовочного автомата. В количестве 6 штук.",
        "5) Соединение (Waldner) 91109551 (42601533) schnellkupplung ",
        ",1.4301,1/8 zo quick release для автомата. В количестве 4 штук.",
        "",
        "-- ",
        "С уважением,",
        "Родина Ольга Владимировна",
    ].join("\n");
    const result = reconstructBodyPositions(body);
    assert.ok(result, "expected reconstruction to fire");
    assert.equal(result.kind, "numbered_list");
    assert.equal(result.rows.length, 5);
    assert.deepEqual(
        result.rows.map((r) => r.article),
        ["42201728", "42206755", "70103107", "91649736", "91109551"]
    );
    assert.deepEqual(result.rows.map((r) => r.quantity), [30, 6, 4, 6, 4]);
    assert.equal(result.rows[0].brandHint, "Waldner");
});

// ─────────────────────────────────────────────────────────────────────────────
// R-4 paired rows — short name line + full spec line sharing the first word
// (7e6a1862, Wedeco .doc table flattened by binary extraction, 9 позиций)
// ─────────────────────────────────────────────────────────────────────────────

test("R-4: name/spec pairs sharing first word → one row per pair", () => {
    const body = [
        "Наименование товара",
        "Требования к качеству, техническим характеристикам",
        "Кол-во",
        "Кольца системы очистки в сборе",
        "Кольца системы очистки в сборе Wiper Holder ТАК48 (PTFE + Viton Артикул",
        "Пневматический цилиндр OSP-P40 760мм",
        "Пневматический цилиндр OSP-P40",
        "Артикул 29741",
        "Щетка для очистки УФ датчика",
        "Щетка 32143-48 М8х5 РР/1.4571 для очистки УФ датчика Артикул 36392",
        "Позиционный выключатель KL3199",
        "Позиционный выключатель KL3199. Артикул 40787",
        "Датчик УФ-",
        "Датчик УФ-интенсивности Onorm M 5873-1:2001-03 SO 13599-17-37-39 Wedeco",
        "Дополнительные требования:",
        "1) Поставка товара производится в течение рабочих дней.",
    ].join("\n");
    const result = reconstructBodyPositions(body);
    assert.ok(result, "expected reconstruction to fire");
    assert.equal(result.kind, "paired_rows");
    assert.equal(result.rows.length, 5);
    assert.match(result.rows[0].descriptionRu, /Wiper Holder ТАК48/);
    assert.match(result.rows[4].descriptionRu, /Датчик УФ-интенсивности/);
});

// R-4 must NOT fire on quoted reply chains with duplicated greeting lines
test("R-4: duplicated identical lines in reply chain → null", () => {
    const body = [
        "Добрый день!",
        "Добрый день!",
        "Прошу прислать реквизиты вашей организации.",
        "Прошу прислать реквизиты вашей организации и каталог.",
        "С уважением, Иван",
    ].join("\n");
    assert.equal(reconstructBodyPositions(body), null);
});

// R-3 must NOT fire on numbered terms/conditions lists (no qty, no codes)
test("R-3: numbered conditions list → null", () => {
    const body = [
        "Не забудьте указать:",
        "1) Срок поставки",
        "2) Условия оплаты",
        "3) В стоимость товара прошу включить доставку",
        "С уважением",
    ].join("\n");
    assert.equal(reconstructBodyPositions(body), null);
});
