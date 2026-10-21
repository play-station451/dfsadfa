# Discord Web Client

A local browser client for Discord that signs in with an **account token** instead of an email and password. The Node server acts as a secure local bridge: the browser stores the token in `localStorage`, and the server forwards REST requests to Discord and relays the Gateway over a same-origin WebSocket.

![Dark Discord-like interface with a server rail, channel sidebar, and message view](https://img.shields.io/badge/status-local%20prototype-5865F2)

## Features

- Sign in with a Discord token; the token is persisted in `localStorage`
- Automatic sign-in on the next visit
- Server rail, channel categories, and direct messages
- Live message updates over the Discord Gateway
- Send messages, reply to messages, and delete your own messages
- Reply previews, typing indicators, attachments, embeds, and safe Markdown rendering
- Unread indicators for channels, servers, and DMs
- Load older messages and jump back to the latest message
- Responsive layout for desktop and mobile
- Token never goes into a URL, query string, cookie, or server log

## Requirements

- Node.js **18.17+** (Node 20+ recommended)
- A Discord account token. This client does not ask for an email or password.

## Run it

```bash
npm install
npm start
```

Open <http://127.0.0.1:3000>.

The server binds to `127.0.0.1` by default. To use a different local port:

```bash
PORT=3001 npm start
```

You can use `npm run dev` to restart the server when files change.

## How it works

```
Browser (public/)
  ├── localStorage: Discord token
  ├── REST /api/*  ───────────────►  Express proxy  ───►  discord.com/api/v10
  └── WebSocket /gateway  ───────►  Gateway relay  ───►  wss://gateway.discord.gg
```

- The browser sends the token to the **local** server in an `X-Discord-Token` header.
- The server forwards it to Discord using the `Authorization` header.
- For live events, the browser opens a same-origin WebSocket and sends the token in the first message. The server identifies to Discord, handles heartbeats, and forwards only client-relevant events.
- The token is stored under the `discord_token` key in `localStorage`. It is not written to the server’s filesystem or logged.

The server does not have a database and does not keep sessions after the browser disconnects.

## Commands

| Command | Description |
| --- | --- |
| `npm start` | Start the app on port 3000 |
| `npm run dev` | Start with Node’s watch mode |
| `npm install` | Install the two runtime dependencies (`express`, `ws`) |

Environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Interface to bind |

## Using a bot token

The UI is designed for account tokens. If you deliberately use a bot token, include the `Bot ` prefix in the input (for example, `Bot MTA...`). The server keeps that prefix for REST requests and strips it for the Gateway identify payload. Most bot accounts will not see user-only DMs or servers.

## Limitations

- This is not an official Discord client. Voice, video, friends, member lists, moderation tools, notifications, and some message types are not implemented.
- The Gateway relay uses a fresh connection rather than Discord’s resume flow. A reconnect fetches recent messages again.
- Custom emoji and attachments require access to Discord’s CDN.
- Markdown is intentionally a safe subset; it does not support every Discord formatting extension.

## Security and account safety

> [!WARNING]
> Logging in to a third-party client with an account token is unofficial and can violate Discord’s Terms of Service. Discord may terminate the account. Use this project only if you understand and accept that risk.

- This app is meant to run locally. It binds to `127.0.0.1` by default; do not expose it to the public internet without adding authentication and TLS.
- Never commit, screenshot, or share your token. Anyone with it can fully control your account.
- The token is stored in plain text in `localStorage`, as requested. Any script that runs on this origin can read it, so keep the code and browser extensions in mind.
- Log out from the account panel to remove the token from `localStorage`.
- Message content is rendered through a custom escaping-based Markdown renderer. Raw HTML is never injected into the page.
- The local server only implements a small fixed set of Discord API routes; it is not a general-purpose open proxy.

## Project layout

```
server.js          Express API proxy + Discord Gateway relay
public/index.html  Login and chat interface
public/styles.css  Discord-inspired dark theme
public/app.js      Browser state, rendering, composer, Gateway handling
```

This project is not affiliated with or endorsed by Discord Inc.
