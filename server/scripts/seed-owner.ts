#!/usr/bin/env tsx
/**
 * Seed the owner account (Alex) and a default workspace with API tokens.
 *
 * Usage:
 *   SEED_OWNER_EMAIL=alex@example.com SEED_OWNER_PASSWORD='...' npm run seed
 *   npm run seed -- --email alex@example.com --password '...'
 */
import { seedOwner } from "../src/lib/seed.js";
import { closeDb } from "../src/lib/db.js";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return undefined;
}

try {
  const result = seedOwner({
    email: arg("email"),
    password: arg("password"),
    workspaceName: arg("workspace-name"),
    workspaceSlug: arg("workspace-slug"),
    createTokens: true,
  });

  if (!result.created) {
    console.log(`Owner already exists: ${result.email}`);
    console.log(`Workspace: ${result.workspaceSlug} (${result.workspaceId})`);
  } else {
    console.log("Seeded owner account:");
    console.log(`  email:     ${result.email}`);
    console.log(`  userId:    ${result.userId}`);
    console.log(`  workspace: ${result.workspaceSlug} (${result.workspaceId})`);
    console.log("");
    console.log("API tokens (shown once — store securely, never commit):");
    console.log(`  WRITE_TOKEN=${result.writeToken}`);
    console.log(`  READ_TOKEN=${result.readToken}`);
  }
} finally {
  closeDb();
}
