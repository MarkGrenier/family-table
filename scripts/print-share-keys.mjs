import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const people = ["Mark", "Emma"];

function passcode() {
  const fromEnv = process.env.PASSCODE?.trim();
  if (fromEnv) return fromEnv;
  let file = "";
  try {
    file = readFileSync(join(root, ".dev.vars"), "utf8");
  } catch {
    file = "";
  }
  const match = file.match(/^PASSCODE=(.*)$/m);
  const value = match?.[1]?.trim() ?? "";
  if (!value) {
    console.error("Set PASSCODE, or add it to .dev.vars, then run this again.");
    process.exit(1);
  }
  return value;
}

export function shareKey(secret, person) {
  const digest = createHmac("sha256", secret).update(`family-share-v1:${person}`).digest("hex");
  const slug = person.toLowerCase().replace(/[^a-z]/g, "") || "person";
  return `ft_${slug}_${digest.slice(0, 32)}`;
}

export function shareKeyText(secret) {
  const lines = [
    "Family Table share keys. Each key only adds a recipe.",
    "The website does not show these.",
    "",
  ];
  for (const person of people) {
    lines.push(person);
    lines.push(shareKey(secret, person));
    lines.push("");
  }
  lines.push("Shortcut address: https://YOUR-SITE.workers.dev/api/share");
  lines.push("");
  return lines.join("\n");
}

const calledDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (calledDirectly) {
  const text = shareKeyText(passcode());
  const file = process.env.SHARE_KEYS_FILE || join(root, "share-keys.txt");
  writeFileSync(file, text);
  process.stdout.write(text);
}
