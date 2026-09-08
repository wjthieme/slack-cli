# slack-cli

> **Disclaimer — read this first**  
> This project is **vibe coded** (experimental, reverse‑engineered against Slack’s non‑public web/desktop client APIs, lightly tested, and maintained informally). **Nothing here is endorsed by Slack.** It may break at any time, leak or mishandle tokens, violate terms of service, or behave in ways you do not expect. **Use is entirely at your own risk.** Do not use it for anything safety‑critical or where misuse could harm you or others.

A small CLI that sets your Slack custom status from **Apple Music** now playing (macOS).

## Commands

| Command | Description |
|--------|-------------|
| **`login [workspace]`** | Interactive Google / SSO login (opens a browser). Paste the redirect URL / magic token after sign-in. Saves credentials under `~/.config/slack-cli/auth.json`. |
| **`music`** | Updates your Slack custom status from **Apple Music** now playing (polls every 5s). **macOS** (AppleScript). |

## Install

```bash
yarn install
```

## Usage (dev)

```bash
yarn start --help
```

Log in first (writes **`~/.config/slack-cli/auth.json`**):

```bash
yarn start login
# or: yarn start login orcacontributors
```

After Google SSO, the browser may try to open the Slack **desktop app**. Cancel that and paste the redirect URL into the CLI instead. If the app already swallowed the handler, open:

`https://<workspace>.slack.com/ssb/signin_redirect/fallback`

…and paste the sign-in key, or paste your `d` cookie (`xoxd-…`) as a fallback.

Then run:

```bash
yarn start music
```

## Credentials (`~/.config/slack-cli/auth.json`)

- **`cookieD`** — Slack session cookie `d` (`xoxd-…`)
- **`cookieDS`** — optional `d-s` cookie
- **`token`** — browser client token (`xoxc-…`)
- **`teamId`**, **`teamDomain`**, **`userId`** — workspace identity

## Notes / requirements

- Uses Slack’s **web/desktop client** session surface (`users.profile.set` with `xoxc` + cookie `d`), not the official Slack app OAuth API. **There is no guarantee this CLI will keep working.**
- **Apple Music** uses AppleScript — **macOS** only.

## Debugging

```bash
yarn dev music
```

## Build

```bash
yarn build
```

Outputs `dist/` and exposes the `slack-status` binary via `package.json`’s `bin` field.
