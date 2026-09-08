import path from "node:path";
import os from "node:os";

/** JSON auth file with cookieD, token, and team identity. */
export const AUTH_DIR = path.join(os.homedir(), ".config", "slack-cli");
export const AUTH_FILE = path.join(AUTH_DIR, "auth.json");

export const SLACK_APP_ORIGIN = "https://app.slack.com";
export const SLACK_SSB_SIGNIN_URL = `${SLACK_APP_ORIGIN}/ssb/signin`;

/** Slack custom status text max length. */
export const STATUS_TEXT_MAX_LEN = 100;

export const MUSIC_STATUS_EMOJI = ":musical_note:";
