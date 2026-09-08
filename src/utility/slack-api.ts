import { SLACK_APP_ORIGIN } from "./config.js";
import { buildCookieHeader, type SlackCredentials } from "./auth.js";
import { debug } from "./debug.js";

export interface SlackTeamInfo {
  id: string;
  domain: string;
  name?: string;
  token: string;
  userId: string;
}

interface ProfileSetBody {
  status_emoji: string;
  status_text: string;
  status_text_canonical: string | null;
  status_expiration?: number;
  status_is_dnd?: boolean;
  ooo_message?: string;
}

function apiUrl(teamDomain: string, method: string): string {
  return `https://${teamDomain}.slack.com/api/${method}`;
}

async function postMultipart(
  creds: SlackCredentials,
  method: string,
  fields: Record<string, string>
): Promise<unknown> {
  const form = new FormData();
  form.set("token", creds.token);
  for (const [k, v] of Object.entries(fields)) {
    form.set(k, v);
  }
  form.set("_x_mode", "online");
  form.set("_x_sonic", "true");
  form.set("_x_app_name", "client");

  const url = apiUrl(creds.teamDomain, method);
  debug("slack:", method, url);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Cookie: buildCookieHeader(creds),
      Origin: SLACK_APP_ORIGIN,
      Accept: "*/*",
    },
    body: form,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Slack ${method} returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  const ok = typeof data === "object" && data !== null && (data as { ok?: boolean }).ok === true;
  if (!res.ok || !ok) {
    const err =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: unknown }).error)
        : text.slice(0, 200);
    throw new Error(`Slack ${method} failed (${res.status}): ${err}`);
  }
  return data;
}

/** Set Slack custom status (HAR: CustomStatusModal:handle_save). */
export async function setStatus(
  creds: SlackCredentials,
  opts: {
    statusText: string;
    statusEmoji: string;
    statusExpiration?: number;
  }
): Promise<void> {
  const profile: ProfileSetBody = {
    status_emoji: opts.statusEmoji,
    status_is_dnd: false,
    status_text: opts.statusText,
    status_text_canonical: "",
    ooo_message: "",
    status_expiration:
      opts.statusExpiration != null && opts.statusExpiration > 0 ? opts.statusExpiration : 0,
  };
  await postMultipart(creds, "users.profile.set", {
    profile: JSON.stringify(profile),
    _x_reason: "CustomStatusModal:handle_save",
  });
}

/** Clear Slack custom status (HAR: UserMenu:clear_status). */
export async function clearStatus(creds: SlackCredentials): Promise<void> {
  const profile: ProfileSetBody = {
    status_emoji: "",
    status_expiration: 0,
    status_text: "",
    status_text_canonical: null,
  };
  await postMultipart(creds, "users.profile.set", {
    profile: JSON.stringify(profile),
    _x_reason: "UserMenu:clear_status",
  });
}

/**
 * Redeem magic login token(s) via auth.loginMagicBulk.
 * Returns Set-Cookie d / d-s and team info from the response.
 */
export async function redeemMagicTokens(magicTokens: string[]): Promise<{
  cookieD: string;
  cookieDS?: string;
  teams: Array<{
    magicToken: string;
    userId: string;
    teamId: string;
    teamDomain: string;
    teamName?: string;
  }>;
}> {
  const url = new URL(`${SLACK_APP_ORIGIN}/api/auth.loginMagicBulk`);
  url.searchParams.set("magic_tokens", magicTokens.join(","));
  url.searchParams.set("ssb", "1");

  debug("slack: loginMagicBulk", magicTokens.map((t) => t.slice(0, 24) + "…").join(","));
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      Origin: SLACK_APP_ORIGIN,
    },
    redirect: "manual",
  });

  const setCookies = collectSetCookies(res);
  const cookieD = extractCookieValue(setCookies, "d");
  const cookieDS = extractCookieValue(setCookies, "d-s");

  const text = await res.text();
  let data: {
    ok?: boolean;
    error?: string;
    token_results?: Record<
      string,
      {
        ok?: boolean;
        user?: string;
        team?: { id?: string; domain?: string; name?: string };
        error?: string;
      }
    >;
  };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    throw new Error(`loginMagicBulk returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!data.ok) {
    throw new Error(`loginMagicBulk failed: ${data.error ?? text.slice(0, 200)}`);
  }

  if (!cookieD?.startsWith("xoxd-")) {
    // Sometimes d is already present / returned differently — try parsing from any set-cookie style.
    throw new Error(
      "loginMagicBulk did not return a d=xoxd-… cookie. The magic token may already have been redeemed (e.g. by the Slack app)."
    );
  }

  const teams: Array<{
    magicToken: string;
    userId: string;
    teamId: string;
    teamDomain: string;
    teamName?: string;
  }> = [];
  for (const [magicToken, result] of Object.entries(data.token_results ?? {})) {
    if (!result.ok || !result.user || !result.team?.id || !result.team?.domain) continue;
    teams.push({
      magicToken,
      userId: result.user,
      teamId: result.team.id,
      teamDomain: result.team.domain,
      ...(result.team.name ? { teamName: result.team.name } : {}),
    });
  }
  if (teams.length === 0) {
    throw new Error("loginMagicBulk succeeded but returned no team results");
  }

  return {
    cookieD,
    ...(cookieDS ? { cookieDS } : {}),
    teams,
  };
}

/**
 * Bootstrap xoxc token(s) from session cookie via GET app.slack.com/auth.
 */
export async function fetchAuthBootstrap(cookieD: string, cookieDS?: string): Promise<SlackTeamInfo[]> {
  const url = new URL(`${SLACK_APP_ORIGIN}/auth`);
  url.searchParams.set("app", "client");
  url.searchParams.set("return_to", "/client");
  url.searchParams.set("teams", "");
  url.searchParams.set("iframe", "1");

  const cookieParts = [`d=${cookieD}`];
  if (cookieDS) cookieParts.push(`d-s=${cookieDS}`);

  debug("slack: GET /auth bootstrap");
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      Cookie: cookieParts.join("; "),
    },
  });
  const html = await res.text();
  if (!res.ok) {
    throw new Error(`GET /auth failed (${res.status}): ${html.slice(0, 200)}`);
  }

  const teams = parseIncomingConfigTeams(html);
  if (teams.length === 0) {
    throw new Error(
      "Could not parse teams/token from app.slack.com/auth. Is the d cookie valid?"
    );
  }
  return teams;
}

function parseIncomingConfigTeams(html: string): SlackTeamInfo[] {
  // sessionStorage.incomingConfig = JSON.stringify({...})
  const m =
    html.match(/sessionStorage\.incomingConfig\s*=\s*JSON\.stringify\((\{[\s\S]*?\})\)\s*;?/) ??
    html.match(/incomingConfig\s*=\s*JSON\.stringify\((\{[\s\S]*?\})\)/);
  if (!m?.[1]) {
    // Sometimes the JSON is embedded escaped inside a string assignment.
    const m2 = html.match(/"teams"\s*:\s*\{/);
    if (!m2) return [];
    // Fallback: extract each "token":"xoxc-..." near team ids
    return parseTeamsLoose(html);
  }

  let config: { teams?: Record<string, Record<string, unknown>> };
  try {
    config = JSON.parse(m[1]) as typeof config;
  } catch {
    // The HTML may contain unescaped content; try to evaluate-safe parse by fixing common issues.
    try {
      // eslint-disable-next-line no-new-func
      config = new Function(`return (${m[1]})`)() as typeof config;
    } catch {
      return parseTeamsLoose(html);
    }
  }

  const out: SlackTeamInfo[] = [];
  for (const [teamId, team] of Object.entries(config.teams ?? {})) {
    const token = typeof team.token === "string" ? team.token : "";
    const domain = typeof team.domain === "string" ? team.domain : "";
    const userId = typeof team.user_id === "string" ? team.user_id : "";
    const name = typeof team.name === "string" ? team.name : undefined;
    if (!token.startsWith("xoxc-") || !domain || !userId) continue;
    out.push({
      id: typeof team.id === "string" ? team.id : teamId,
      domain,
      token,
      userId,
      ...(name ? { name } : {}),
    });
  }
  return out.length > 0 ? out : parseTeamsLoose(html);
}

function parseTeamsLoose(html: string): SlackTeamInfo[] {
  const out: SlackTeamInfo[] = [];
  // Look for team objects with token/domain/user_id
  const teamBlocks = html.matchAll(
    /"(T[A-Z0-9]+)"\s*:\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g
  );
  for (const match of teamBlocks) {
    const id = match[1]!;
    const body = match[2]!;
    const token = body.match(/"token"\s*:\s*"(xoxc-[^"]+)"/)?.[1];
    const domain = body.match(/"domain"\s*:\s*"([^"]+)"/)?.[1];
    const userId = body.match(/"user_id"\s*:\s*"(U[^"]+)"/)?.[1];
    const name = body.match(/"name"\s*:\s*"([^"]+)"/)?.[1];
    if (!token || !domain || !userId) continue;
    out.push({ id, domain, token, userId, ...(name ? { name } : {}) });
  }
  // Deduplicate by id
  const seen = new Set<string>();
  return out.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

function collectSetCookies(res: Response): string[] {
  // undici / Node may expose getSetCookie()
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

function extractCookieValue(setCookies: string[], name: string): string | undefined {
  for (const sc of setCookies) {
    const m = sc.match(new RegExp(`(?:^|,\\s*|\\n)${name}=([^;\\s,]+)`, "i")) ??
      sc.match(new RegExp(`^${name}=([^;\\s]+)`, "i"));
    if (m?.[1]) {
      try {
        return decodeURIComponent(m[1]);
      } catch {
        return m[1];
      }
    }
  }
  // Also handle concatenated set-cookie without getSetCookie
  for (const sc of setCookies) {
    const m = sc.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    if (m?.[1] && (name !== "d" || m[1].startsWith("xoxd-") || m[1].startsWith("xoxd%"))) {
      try {
        return decodeURIComponent(m[1]);
      } catch {
        return m[1];
      }
    }
  }
  return undefined;
}
