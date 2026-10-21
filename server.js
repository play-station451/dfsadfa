'use strict';

const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { WebSocket, WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DISCORD_API = 'https://discord.com/api/v10';
const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// GUILDS, GUILD_MESSAGES and DIRECT_MESSAGES. Message content is available to
// user accounts without the privileged bot intent.
const GATEWAY_INTENTS = (1 << 0) | (1 << 9) | (1 << 12);

const FORWARDED_EVENTS = new Set([
  'MESSAGE_CREATE',
  'MESSAGE_UPDATE',
  'MESSAGE_DELETE',
  'MESSAGE_DELETE_BULK',
  'CHANNEL_CREATE',
  'CHANNEL_UPDATE',
  'CHANNEL_DELETE',
  'CHANNEL_PINS_UPDATE',
  'GUILD_CREATE',
  'GUILD_UPDATE',
  'GUILD_DELETE',
  'TYPING_START',
  'RELATIONSHIP_ADD',
  'RELATIONSHIP_REMOVE',
  'RELATIONSHIP_UPDATE',
  'MESSAGE_REACTION_ADD',
  'MESSAGE_REACTION_REMOVE',
  'MESSAGE_REACTION_REMOVE_ALL',
]);

const app = express();
const server = http.createServer(app);

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' https://cdn.discordapp.com https://media.discordapp.net data:",
      "connect-src 'self'",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

app.use(
  express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],
    etag: true,
    maxAge: 0,
  }),
);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getToken(req) {
  const token = req.get('x-discord-token');
  if (!token || typeof token !== 'string') {
    throw new HttpError(401, 'Missing Discord token.');
  }
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 400) {
    throw new HttpError(401, 'Invalid Discord token.');
  }
  return trimmed;
}

function snowflake(value, label = 'ID') {
  if (typeof value !== 'string' || !/^\d{5,25}$/.test(value)) {
    throw new HttpError(400, `Invalid ${label}.`);
  }
  return value;
}

async function discordRequest(route, options = {}) {
  const { method = 'GET', token, body } = options;
  const headers = {
    Authorization: token,
    Accept: 'application/json',
    'User-Agent': USER_AGENT,
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let response;
  try {
    response = await fetch(`${DISCORD_API}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    if (error.name === 'TimeoutError') {
      throw new HttpError(504, 'Discord did not respond in time.');
    }
    throw new HttpError(502, 'Could not reach Discord.');
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const message =
      (data && typeof data.message === 'string' && data.message) ||
      `Discord request failed (HTTP ${response.status}).`;
    const error = new HttpError(
      response.status === 401 ? 401 : response.status,
      message,
    );
    error.discordCode = data && data.code;
    error.retryAfter = data && data.retry_after;
    throw error;
  }

  return { status: response.status, data };
}

app.get('/api/me', async (req, res, next) => {
  try {
    const token = getToken(req);
    const { data } = await discordRequest('/users/@me', { token });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

app.get('/api/guilds', async (req, res, next) => {
  try {
    const token = getToken(req);
    const { data } = await discordRequest('/users/@me/guilds', { token });
    res.json(Array.isArray(data) ? data : []);
  } catch (error) {
    next(error);
  }
});

app.get('/api/private-channels', async (req, res, next) => {
  try {
    const token = getToken(req);
    const { data } = await discordRequest('/users/@me/channels', { token });
    res.json(Array.isArray(data) ? data : []);
  } catch (error) {
    next(error);
  }
});

app.get('/api/guilds/:guildId/channels', async (req, res, next) => {
  try {
    const token = getToken(req);
    const guildId = snowflake(req.params.guildId, 'guild ID');
    const { data } = await discordRequest(`/guilds/${guildId}/channels`, { token });
    res.json(Array.isArray(data) ? data : []);
  } catch (error) {
    next(error);
  }
});

app.get('/api/channels/:channelId/messages', async (req, res, next) => {
  try {
    const token = getToken(req);
    const channelId = snowflake(req.params.channelId, 'channel ID');
    const params = new URLSearchParams({ limit: '50' });
    if (typeof req.query.before === 'string' && req.query.before) {
      params.set('before', snowflake(req.query.before, 'message ID'));
    }
    if (typeof req.query.after === 'string' && req.query.after) {
      params.set('after', snowflake(req.query.after, 'message ID'));
    }
    const { data } = await discordRequest(
      `/channels/${channelId}/messages?${params}`,
      { token },
    );
    res.json(Array.isArray(data) ? data : []);
  } catch (error) {
    next(error);
  }
});

app.post('/api/channels/:channelId/messages', async (req, res, next) => {
  try {
    const token = getToken(req);
    const channelId = snowflake(req.params.channelId, 'channel ID');
    const content =
      typeof req.body?.content === 'string' ? req.body.content : '';

    if (!content.trim()) {
      throw new HttpError(400, 'Message cannot be empty.');
    }
    if (content.length > 2000) {
      throw new HttpError(400, 'Messages can be at most 2,000 characters.');
    }

    const payload = {
      content,
      allowed_mentions: {
        parse: ['users', 'roles', 'everyone'],
        replied_user: true,
      },
    };

    if (req.body?.replyTo) {
      const replyTo = snowflake(String(req.body.replyTo), 'message ID');
      payload.message_reference = {
        message_id: replyTo,
        channel_id: channelId,
        fail_if_not_exists: false,
      };
    }

    const { data } = await discordRequest(
      `/channels/${channelId}/messages`,
      { method: 'POST', token, body: payload },
    );
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/messages/:messageId', async (req, res, next) => {
  try {
    const token = getToken(req);
    const messageId = snowflake(req.params.messageId, 'message ID');
    const content =
      typeof req.body?.content === 'string' ? req.body.content : '';

    if (!content.trim()) {
      throw new HttpError(400, 'Message cannot be empty.');
    }
    if (content.length > 2000) {
      throw new HttpError(400, 'Messages can be at most 2,000 characters.');
    }

    const channelId = snowflake(String(req.body?.channelId || ''), 'channel ID');
    const { data } = await discordRequest(
      `/channels/${channelId}/messages/${messageId}`,
      {
        method: 'PATCH',
        token,
        body: {
          content,
          allowed_mentions: { parse: ['users', 'roles', 'everyone'] },
        },
      },
    );
    res.json(data);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/messages/:messageId', async (req, res, next) => {
  try {
    const token = getToken(req);
    const messageId = snowflake(req.params.messageId, 'message ID');
    const channelId = snowflake(String(req.query.channelId || ''), 'channel ID');
    await discordRequest(`/channels/${channelId}/messages/${messageId}`, {
      method: 'DELETE',
      token,
    });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post('/api/channels/:channelId/typing', async (req, res, next) => {
  try {
    const token = getToken(req);
    const channelId = snowflake(req.params.channelId, 'channel ID');
    await discordRequest(`/channels/${channelId}/typing`, {
      method: 'POST',
      token,
    });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, req, res, _next) => {
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) {
    console.error(`[api] ${req.method} ${req.path}: ${error.message}`);
  }
  if (res.headersSent) return;
  const body = {
    error:
      status >= 500 && !(error instanceof HttpError)
        ? 'Unexpected server error.'
        : error.message || 'Request failed.',
  };
  if (error.discordCode) body.code = error.discordCode;
  if (typeof error.retryAfter === 'number') {
    body.retry_after = error.retryAfter;
    res.setHeader('Retry-After', Math.ceil(error.retryAfter));
  }
  res.status(status).json(body);
});

// ---------------------------------------------------------------------------
// Discord Gateway relay
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({
  server,
  path: '/gateway',
  maxPayload: 16 * 1024,
});

const liveClients = new Set();

function sendJson(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
    return true;
  }
  return false;
}

function closeBrowserSocket(socket, payload, code = 1000, reason = '') {
  sendJson(socket, payload);
  setTimeout(() => {
    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
      socket.close(code, reason);
    }
  }, 60);
}

const socketPing = setInterval(() => {
  for (const client of liveClients) {
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    try {
      client.ping();
    } catch {
      client.terminate();
    }
  }
}, 30_000);
socketPing.unref();

wss.on('connection', (socket) => {
  liveClients.add(socket);
  socket.isAlive = true;
  socket.on('pong', () => {
    socket.isAlive = true;
  });

  let gateway = null;
  let heartbeatTimer = null;
  let heartbeatAcknowledged = true;
  let sequence = null;
  let authenticated = false;
  let browserClosed = false;
  let finished = false;
  let hasConnected = false;

  const authTimer = setTimeout(() => {
    if (!authenticated) {
      closeBrowserSocket(
        socket,
        { type: 'error', fatal: true, message: 'Authentication timed out.' },
      );
    }
  }, 10_000);

  function clearHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function disconnectGateway() {
    clearHeartbeat();
    if (gateway) {
      try {
        if (
          gateway.readyState === WebSocket.OPEN ||
          gateway.readyState === WebSocket.CONNECTING
        ) {
          gateway.close(1000, 'Client disconnected');
        }
      } catch {
        // Already gone.
      }
      gateway = null;
    }
  }

  socket.on('close', () => {
    browserClosed = true;
    clearTimeout(authTimer);
    disconnectGateway();
    liveClients.delete(socket);
  });

  socket.on('error', () => {
    // A close event follows this; nothing else to do.
  });

  socket.on('message', (raw) => {
    if (authenticated || finished) return;

    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      closeBrowserSocket(
        socket,
        { type: 'error', fatal: true, message: 'Invalid gateway request.' },
      );
      return;
    }

    if (message?.type !== 'auth' || typeof message.token !== 'string') {
      closeBrowserSocket(
        socket,
        { type: 'error', fatal: true, message: 'Missing gateway token.' },
      );
      return;
    }

    const token = message.token.trim();
    if (!token || token.length > 400) {
      closeBrowserSocket(
        socket,
        { type: 'error', fatal: true, message: 'Invalid token.' },
      );
      return;
    }

    authenticated = true;
    clearTimeout(authTimer);
    connectGateway(token);
  });

  function connectGateway(token) {
    if (browserClosed || finished) return;

    let identifySent = false;
    const sessionToken = token.replace(/^Bot\s+/i, '');

    try {
      gateway = new WebSocket(GATEWAY_URL, {
        headers: {
          'User-Agent': USER_AGENT,
        },
        handshakeTimeout: 15_000,
      });
    } catch {
      failReconnectable('Could not start the Discord gateway.');
      return;
    }

    gateway.on('open', () => {
      if (browserClosed) {
        disconnectGateway();
      }
    });

    gateway.on('message', (raw) => {
      if (browserClosed) return;

      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const { op, d, t, s } = payload;
      if (typeof s === 'number') sequence = s;

      if (op === 10) {
        const interval =
          d && Number.isFinite(d.heartbeat_interval)
            ? d.heartbeat_interval
            : 41_250;

        clearHeartbeat();
        heartbeatAcknowledged = true;
        heartbeatTimer = setInterval(() => {
          if (!gateway || gateway.readyState !== WebSocket.OPEN) return;
          if (!heartbeatAcknowledged) {
            failReconnectable('Discord gateway heartbeat was not acknowledged.');
            return;
          }
          heartbeatAcknowledged = false;
          try {
            gateway.send(JSON.stringify({ op: 1, d: sequence }));
          } catch {
            failReconnectable('Lost connection to the Discord gateway.');
          }
        }, interval);
        heartbeatTimer.unref();

        sendIdentify();
        return;
      }

      if (op === 11) {
        heartbeatAcknowledged = true;
        return;
      }

      if (op === 1) {
        if (gateway?.readyState === WebSocket.OPEN) {
          gateway.send(JSON.stringify({ op: 1, d: sequence }));
        }
        return;
      }

      if (op === 7) {
        failReconnectable('Discord requested a gateway reconnect.');
        return;
      }

      if (op === 9) {
        if (d === true) {
          const delay = Math.floor(1000 + Math.random() * 4000);
          setTimeout(() => {
            if (!browserClosed && gateway?.readyState === WebSocket.OPEN) {
              identifySent = false;
              sendIdentify();
            }
          }, delay);
        } else {
          closeBrowserSocket(
            socket,
            {
              type: 'error',
              fatal: true,
              message: 'Discord rejected the gateway session. Please sign in again.',
            },
          );
        }
        return;
      }

      if (op !== 0 || !t) return;

      if (t === 'READY') {
        hasConnected = true;
        sendJson(socket, {
          type: 'ready',
          user: d?.user || null,
          sessionId: d?.session_id || null,
        });
        return;
      }

      if (FORWARDED_EVENTS.has(t)) {
        sendJson(socket, { type: 'dispatch', event: t, data: d });
      }
    });

    gateway.on('unexpected-response', (_request, response) => {
      if (response?.statusCode === 401 || response?.statusCode === 403) {
        fatalAuthError('Discord rejected the token.');
      } else {
        failReconnectable(
          `Discord gateway returned HTTP ${response?.statusCode || 'error'}.`,
        );
      }
    });

    gateway.on('error', () => {
      // The close handler reports the error with more context.
    });

    gateway.on('close', (code, reasonBuffer) => {
      clearHeartbeat();
      if (browserClosed || finished) return;

      const reason = reasonBuffer?.toString()?.trim();
      let detail = reason || '';
      if (code === 4004) {
        fatalAuthError('Invalid Discord token.');
        return;
      }
      if (code === 4014) {
        fatalAuthError(
          'Discord did not allow this connection. The account token may not be permitted to use gateway intents.',
        );
        return;
      }
      if (code === 4000 && !hasConnected) {
        fatalAuthError(
          'Discord rejected the gateway identify. This token may not support this client.',
        );
        return;
      }
      if (code === 4003 || code === 4005) {
        fatalAuthError(`Discord closed the connection (${code}). Try again later.`);
        return;
      }

      const messages = {
        4000: 'Unknown gateway error.',
        4001: 'Unknown gateway opcode.',
        4002: 'Invalid gateway payload.',
        4003: 'The gateway connection was not authenticated.',
        4005: 'Discord asked the client to reconnect.',
        4007: 'Invalid gateway sequence.',
        4008: 'Gateway rate limited.',
        4009: 'Gateway session timed out.',
        4010: 'Invalid gateway shard.',
        4011: 'Gateway requires a shard.',
        4012: 'Invalid gateway version.',
        4013: 'Invalid gateway intent.',
        4014: 'Disallowed gateway intent.',
      };

      failReconnectable(
        messages[code] || detail || 'The Discord gateway connection closed.',
      );
    });

    gateway.on('ping', () => {
      // The ws library replies automatically; nothing else needed.
    });

    function sendIdentify() {
      if (!gateway || gateway.readyState !== WebSocket.OPEN || identifySent) {
        return;
      }
      identifySent = true;

      const identify = {
        op: 2,
        d: {
          token: sessionToken,
          capabilities: 30_717,
          compress: false,
          intents: GATEWAY_INTENTS,
          properties: {
            os: 'Windows',
            browser: 'Chrome',
            device: '',
            system_locale: 'en-US',
            browser_user_agent: USER_AGENT,
            browser_version: '124.0.0.0',
            os_version: '10',
            referrer: '',
            referring_domain: '',
            release_channel: 'stable',
            client_build_number: 300_000,
            client_event_source: null,
          },
          presence: {
            status: 'online',
            since: 0,
            activities: [],
            afk: false,
          },
        },
      };

      try {
        gateway.send(JSON.stringify(identify));
      } catch {
        failReconnectable('Could not authenticate with the Discord gateway.');
      }
    }

    function fatalAuthError(message) {
      if (finished || browserClosed) return;
      finished = true;
      disconnectGateway();
      closeBrowserSocket(
        socket,
        { type: 'error', fatal: true, message },
        4001,
        'Authentication failed',
      );
    }

    function failReconnectable(message) {
      if (finished || browserClosed) return;
      finished = true;
      disconnectGateway();
      closeBrowserSocket(
        socket,
        { type: 'closed', reconnectable: true, message },
        4000,
        'Gateway closed',
      );
    }
  }
});

wss.on('error', (error) => {
  console.error(`[gateway] ${error.message}`);
});

server.listen(PORT, HOST, () => {
  console.log(`Discord web client running at http://${HOST}:${PORT}`);
  console.log('The server is bound to localhost by default. Do not expose it publicly.');
});
