import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Runs once per test file, outside the isolated copy, and is safe to repeat.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
