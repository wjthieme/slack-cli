/**
 * Interactive Slack login via SSB sign-in + Google SSO (same UX as gather-cli).
 * Opens the browser; after sign-in the user pastes the redirect URL / magic token.
 *
 * Usage: yarn start login [workspace]
 */
import { exec } from "node:child_process";
import * as readline from "node:readline";
import { AUTH_FILE, SLACK_SSB_SIGNIN_URL } from "../utility/config.js";
import { writeCredentials, type SlackCredentials } from "../utility/auth.js";
import {
  fetchAuthBootstrap,
  redeemMagicTokens,
  type SlackTeamInfo,
} from "../utility/slack-api.js";
import { debug } from "../utility/debug.js";

const MAGIC_TOKEN_RE = /z-app-T[A-Z0-9]+-\d+-[a-f0-9]{32,}/i;
const XOXD_RE = /xoxd-[A-Za-z0-9%._-]+/;

export async function runLogin(workspaceArg?: string): Promise<void> {
  const workspace = workspaceArg?.trim().replace(/\.slack\.com$/i, "").replace(/^https?:\/\//i, "");
  const signinUrl = workspace
    ? `https://${workspace}.slack.com/signin`
    : SLACK_SSB_SIGNIN_URL;

  openBrowser(signinUrl);
  console.log("Opening browser to sign in to Slack…");
  console.log("Sign in with Google / SSO in the browser.");
  console.log("");
  console.log("After signing in, the browser may try to open the Slack desktop app.");
  console.log("Cancel that if you can, then paste ONE of:");
  console.log("  • the full redirect URL (slack://…/magic-login/… or https://…)");
  console.log("  • the magic token (z-app-T…)");
  console.log("  • the sign-in key from /ssb/signin_redirect/fallback");
  console.log("  • your d cookie (xoxd-…) if the Slack app already captured the redirect");
  console.log("");

  const pasted = await promptLine("Paste redirect URL / magic token / d cookie: ");
  const parsed = parseLoginPaste(pasted);
  if (!parsed) {
    throw new Error(
      "Could not find a magic token (z-app-…) or d cookie (xoxd-…) in what you pasted."
    );
  }

  let cookieD: string;
  let cookieDS: string | undefined;
  let preferredTeamId: string | undefined;
  let preferredUserId: string | undefined;
  let preferredDomain: string | undefined;

  if (parsed.kind === "magic") {
    const redeemed = await redeemMagicTokens([parsed.magicToken]);
    cookieD = redeemed.cookieD;
    cookieDS = redeemed.cookieDS;
    const team = redeemed.teams[0]!;
    preferredTeamId = team.teamId;
    preferredUserId = team.userId;
    preferredDomain = team.teamDomain;
    console.log(
      `Redeemed magic token for ${team.teamName ?? team.teamDomain} (${team.teamId}).`
    );
  } else {
    cookieD = parsed.cookieD;
    console.log("Using pasted d cookie…");
  }

  const teams = await fetchAuthBootstrap(cookieD, cookieDS);
  debug(
    "auth bootstrap teams:",
    teams.map((t) => `${t.domain}/${t.id}`).join(", ")
  );

  const selected = await selectTeam(teams, {
    preferredTeamId,
    preferredDomain,
    preferredUserId,
  });

  const creds: SlackCredentials = {
    cookieD,
    token: selected.token,
    teamId: selected.id,
    teamDomain: selected.domain,
    userId: selected.userId,
    ...(cookieDS ? { cookieDS } : {}),
  };
  writeCredentials(creds);
  console.log(`Credentials saved to ${AUTH_FILE}`);
  console.log(`Workspace: ${selected.name ?? selected.domain} (${selected.id})`);
}

export function parseLoginPaste(
  input: string
): { kind: "magic"; magicToken: string } | { kind: "cookie"; cookieD: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Raw or URL-encoded xoxd cookie
  const xoxdMatch = trimmed.match(XOXD_RE);
  if (xoxdMatch && !MAGIC_TOKEN_RE.test(trimmed)) {
    let cookieD = xoxdMatch[0];
    try {
      cookieD = decodeURIComponent(cookieD);
    } catch {
      /* keep raw */
    }
    // Cookie header form: d=xoxd-...
    const fromHeader = trimmed.match(/(?:^|[;\s])d=(xoxd-[^;\s]+)/i);
    if (fromHeader?.[1]) {
      try {
        cookieD = decodeURIComponent(fromHeader[1]);
      } catch {
        cookieD = fromHeader[1];
      }
    }
    return { kind: "cookie", cookieD };
  }

  // slack://TEAM/magic-login/TOKEN or path containing magic-login
  try {
    if (trimmed.startsWith("slack://") || trimmed.includes("://")) {
      const normalized = trimmed.startsWith("slack://")
        ? trimmed.replace(/^slack:\/\//, "https://slack.invalid/")
        : trimmed;
      const u = new URL(normalized);
      const pathParts = u.pathname.split("/").filter(Boolean);
      const magicIdx = pathParts.findIndex((p) => p.toLowerCase() === "magic-login");
      if (magicIdx >= 0 && pathParts[magicIdx + 1]) {
        const tokenPart = pathParts[magicIdx + 1]!;
        if (MAGIC_TOKEN_RE.test(tokenPart)) {
          return { kind: "magic", magicToken: tokenPart.match(MAGIC_TOKEN_RE)![0]! };
        }
        // Some URLs use the hash/id as the last segment without z-app- prefix in path,
        // but loginMagicBulk expects z-app-… form. Prefer explicit z-app match below.
      }
      // Query params
      for (const key of ["magic_tokens", "magic_token", "token", "code", "key"]) {
        const v = u.searchParams.get(key);
        if (v && MAGIC_TOKEN_RE.test(v)) {
          return { kind: "magic", magicToken: v.match(MAGIC_TOKEN_RE)![0]! };
        }
        if (v && XOXD_RE.test(v)) {
          return { kind: "cookie", cookieD: decodeURIComponent(v.match(XOXD_RE)![0]!) };
        }
      }
    }
  } catch {
    /* fall through */
  }

  const magic = trimmed.match(MAGIC_TOKEN_RE);
  if (magic) {
    return { kind: "magic", magicToken: magic[0]! };
  }

  // Sign-in key sometimes looks like the z-app token alone on a line
  if (trimmed.startsWith("z-app-")) {
    return { kind: "magic", magicToken: trimmed.split(/\s+/)[0]! };
  }

  if (xoxdMatch) {
    let cookieD = xoxdMatch[0];
    try {
      cookieD = decodeURIComponent(cookieD);
    } catch {
      /* keep */
    }
    return { kind: "cookie", cookieD };
  }

  return null;
}

async function selectTeam(
  teams: SlackTeamInfo[],
  preferred: {
    preferredTeamId?: string;
    preferredDomain?: string;
    preferredUserId?: string;
  }
): Promise<SlackTeamInfo> {
  if (teams.length === 1) return teams[0]!;

  const byId = preferred.preferredTeamId
    ? teams.find((t) => t.id === preferred.preferredTeamId)
    : undefined;
  if (byId) return byId;

  const byDomain = preferred.preferredDomain
    ? teams.find((t) => t.domain === preferred.preferredDomain)
    : undefined;
  if (byDomain) return byDomain;

  console.log("Multiple workspaces found:");
  teams.forEach((t, i) => {
    console.log(`  [${i + 1}] ${t.name ?? t.domain} (${t.id}) — ${t.domain}.slack.com`);
  });
  const answer = await promptLine(`Select workspace [1-${teams.length}]: `);
  const idx = Number.parseInt(answer.trim(), 10);
  if (!Number.isFinite(idx) || idx < 1 || idx > teams.length) {
    throw new Error("Invalid workspace selection");
  }
  return teams[idx - 1]!;
}

function promptLine(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (input) => {
      rl.close();
      resolve(input);
    });
  });
}

function openBrowser(url: string): void {
  let cmd: string;
  switch (process.platform) {
    case "darwin":
      cmd = "open";
      break;
    case "win32":
      cmd = "start";
      break;
    default:
      cmd = "xdg-open";
      break;
  }
  exec(`${cmd} "${url}"`, () => {});
}
