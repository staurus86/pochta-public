import assert from "node:assert/strict";
import { parseMailboxConfigText } from "../src/services/mailbox-config-parser.js";

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

runTest("parses mailbox rows from 1.txt format", () => {
  const accounts = parseMailboxConfigText(`
Почта\tАдминка почты\tПароль\tСборщик почты\tСайт EMD\tБренд
info@ersab2b.ru\thttps://webmail.hosting.reg.ru/\tpass123\temd@siderus.su\thttps://ersab2b.ru\tErsa
`);

  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].mailbox, "info@ersab2b.ru");
  assert.equal(accounts[0].brand, "Ersa");
  assert.equal(accounts[0].siteUrl, "https://ersab2b.ru");
});
