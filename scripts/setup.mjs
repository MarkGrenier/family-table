import { spawnSync } from "node:child_process";

function wrangler(args) {
  const result = spawnSync("npx", ["wrangler", ...args], {
    stdio: "inherit",
    env: { ...process.env, CI: "1" },
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

wrangler(["d1", "migrations", "apply", "grocery", "--local"]);
wrangler(["d1", "execute", "grocery", "--local", "--yes", "--file=./seed.sql"]);
