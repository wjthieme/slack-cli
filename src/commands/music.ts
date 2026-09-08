/**
 * Slack music status: every 5s get Apple Music track and set/clear Slack custom status.
 */
import { ensureLoggedIn } from "../utility/auth.js";
import {
  formatNowPlayingStatus,
  getNowPlayingWithPosition,
} from "../utility/apple-music.js";
import { clearStatus, setStatus } from "../utility/slack-api.js";
import { MUSIC_STATUS_EMOJI, STATUS_TEXT_MAX_LEN } from "../utility/config.js";
import { debug } from "../utility/debug.js";

const INTERVAL_MS = 5000;
/** Extra seconds past track end before Slack clears the status (2× poll interval). */
const STATUS_EXPIRY_MARGIN_SEC = (INTERVAL_MS / 1000) * 2;

function truncateStatus(text: string, maxLen: number): string {
  const t = text.trim();
  const chars = Array.from(t);
  if (chars.length <= maxLen) return t;
  return chars.slice(0, maxLen).join("");
}

export async function runMusic(): Promise<void> {
  if (process.platform !== "darwin") {
    console.error("music requires macOS (Apple Music via AppleScript).");
    process.exit(1);
  }

  const creds = ensureLoggedIn();
  /** null = never set by us; "" = cleared; otherwise last set key */
  let lastStatusKey: string | null = null;

  const tick = async () => {
    debug("--- tick ---");
    const nowPlaying = getNowPlayingWithPosition();
    debug(
      "Apple Music:",
      nowPlaying
        ? `"${nowPlaying.title}" · "${nowPlaying.artist}" @ ${nowPlaying.positionSec.toFixed(1)}s / ${nowPlaying.durationSec.toFixed(1)}s`
        : "nothing playing / paused"
    );

    if (!nowPlaying) {
      if (lastStatusKey === null || lastStatusKey === "") {
        debug("skip: nothing playing and no status to clear");
        return;
      }
      try {
        await clearStatus(creds);
        lastStatusKey = "";
        console.log("Cleared Slack status (nothing playing).");
      } catch (err) {
        console.warn("Clear status error:", err);
        // keep lastStatusKey so we retry clear next tick
      }
      return;
    }

    const statusText = truncateStatus(formatNowPlayingStatus(nowPlaying), STATUS_TEXT_MAX_LEN);
    if (!statusText) {
      debug("skip: empty status text");
      return;
    }

    let statusExpiration: number | undefined;
    if (nowPlaying.durationSec > 0 && nowPlaying.positionSec >= 0) {
      const remaining = Math.max(0, nowPlaying.durationSec - nowPlaying.positionSec);
      // Expire after track end + 2× poll interval so a late tick can still refresh or clear.
      statusExpiration =
        Math.floor(Date.now() / 1000) + Math.ceil(remaining) + STATUS_EXPIRY_MARGIN_SEC;
    }

    const statusKey = `${statusText}|${MUSIC_STATUS_EMOJI}`;
    if (statusKey === lastStatusKey) {
      debug("skip: status unchanged");
      return;
    }

    try {
      await setStatus(creds, {
        statusText,
        statusEmoji: MUSIC_STATUS_EMOJI,
        ...(statusExpiration != null ? { statusExpiration } : {}),
      });
      lastStatusKey = statusKey;
      console.log(`Slack status → ${MUSIC_STATUS_EMOJI} ${statusText}`);
    } catch (err) {
      console.warn("Set status error:", err);
      // keep previous key so we retry if it still differs
    }
  };

  const cleanup = async () => {
    try {
      await clearStatus(creds);
      console.log("Cleared Slack status.");
    } catch {
      /* ignore */
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => {
    void cleanup();
  });
  process.on("SIGTERM", () => {
    void cleanup();
  });

  console.log(`Polling Apple Music every ${INTERVAL_MS / 1000}s (Ctrl+C to clear status and exit)…`);
  await tick();
  setInterval(() => {
    void tick();
  }, INTERVAL_MS);
}
