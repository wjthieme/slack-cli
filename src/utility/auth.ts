import fs from "node:fs";
import { AUTH_DIR, AUTH_FILE } from "./config.js";

export interface SlackCredentials {
  cookieD: string;
  cookieDS?: string;
  token: string;
  teamId: string;
  teamDomain: string;
  userId: string;
}

interface AuthFileData {
  cookieD?: string;
  cookieDS?: string;
  token?: string;
  teamId?: string;
  teamDomain?: string;
  userId?: string;
}

function ensureAuthDir(): void {
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }
}

/** Read credentials from auth.json. */
export function loadCredentials(): SlackCredentials | null {
  try {
    if (!fs.existsSync(AUTH_FILE)) return null;
    const raw = fs.readFileSync(AUTH_FILE, "utf-8");
    const parsed = JSON.parse(raw) as AuthFileData;
    const cookieD = typeof parsed.cookieD === "string" ? parsed.cookieD : "";
    const token = typeof parsed.token === "string" ? parsed.token : "";
    const teamId = typeof parsed.teamId === "string" ? parsed.teamId : "";
    const teamDomain = typeof parsed.teamDomain === "string" ? parsed.teamDomain : "";
    const userId = typeof parsed.userId === "string" ? parsed.userId : "";
    if (!cookieD || !token || !teamId || !teamDomain || !userId) return null;
    const cookieDS =
      typeof parsed.cookieDS === "string" && parsed.cookieDS ? parsed.cookieDS : undefined;
    return {
      cookieD,
      token,
      teamId,
      teamDomain,
      userId,
      ...(cookieDS ? { cookieDS } : {}),
    };
  } catch {
    return null;
  }
}

/** Write credentials to auth.json. */
export function writeCredentials(creds: SlackCredentials): void {
  ensureAuthDir();
  const data: AuthFileData = {
    cookieD: creds.cookieD,
    token: creds.token,
    teamId: creds.teamId,
    teamDomain: creds.teamDomain,
    userId: creds.userId,
    ...(creds.cookieDS ? { cookieDS: creds.cookieDS } : {}),
  };
  fs.writeFileSync(AUTH_FILE, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

const LOGIN_INSTRUCTIONS = `
No Slack credentials found. Run:  yarn start login

After Google SSO, paste the redirect URL / magic token (or use the sign-in key
fallback / paste your d cookie if the Slack app already captured the redirect).
`;

/** Ensures we have credentials on disk. */
export function ensureLoggedIn(): SlackCredentials {
  const creds = loadCredentials();
  if (!creds) {
    console.error(LOGIN_INSTRUCTIONS);
    process.exit(1);
  }
  return creds;
}

/** Build Cookie header for Slack API requests. */
export function buildCookieHeader(creds: Pick<SlackCredentials, "cookieD" | "cookieDS">): string {
  const parts = [`d=${creds.cookieD}`];
  if (creds.cookieDS) parts.push(`d-s=${creds.cookieDS}`);
  return parts.join("; ");
}
