import { readFile } from "node:fs/promises";

export async function readMailboxConfigFile(filePath) {
  const contents = await readFile(filePath, "utf-8");
  return parseMailboxConfigText(contents);
}

export function parseMailboxConfigText(contents) {
  return String(contents || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("@") && line.includes("\t"))
    .map((line) => {
      const [mailbox, webmailUrl, password, collectorEmail, siteUrl, brand] = line.split("\t");
      return {
        mailbox: mailbox?.trim() || "",
        webmailUrl: webmailUrl?.trim() || "",
        password: password?.trim() || "",
        collectorEmail: collectorEmail?.trim() || "",
        siteUrl: siteUrl?.trim() || "",
        brand: brand?.trim() || ""
      };
    })
    .filter((account) => account.mailbox && account.password);
}
