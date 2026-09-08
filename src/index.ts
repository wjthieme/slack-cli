#! /usr/bin/env node
import "./utility/proxy-env.js";
import { runLogin } from "./commands/login.js";
import { runMusic } from "./commands/music.js";

const subcommand = process.argv[2];

async function main(): Promise<void> {
  if (process.env.DEBUG) {
    console.log("Debug mode enabled (DEBUG=1)");
  }

  switch (subcommand) {
    case "music":
      await runMusic();
      break;
    case "login":
      await runLogin(process.argv[3]);
      break;
    default:
      if (subcommand === "-h" || subcommand === "--help" || !subcommand) {
        console.log(`
Usage: ${process.argv[0]} <command> [options]

Commands:
  login [workspace]   Interactive Google/SSO login (opens browser); paste redirect URL / magic token
  music               Update Slack custom status from Apple Music (every 5s)

Examples:
  ${process.argv[0]} login
  ${process.argv[0]} login orcacontributors
  ${process.argv[0]} music
`);
        process.exit(0);
      }
      console.error("Unknown command:", subcommand);
      console.error(`Run '${process.argv[0]} --help' for usage.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
