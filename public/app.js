'use strict';

(() => {
  const TOKEN_KEY = 'discord_token';
  const LAST_CHANNEL_KEY = 'discord_last_channel';
  const LAST_GUILD_KEY = 'discord_last_guild';
  const MESSAGE_LIMIT = 50;
  const TYPING_TIMEOUT = 8500;

  const $ = (id) => document.getElementById(id);

  const dom = {
    loginView: $('login-view'),
    loginForm: $('login-form'),
    tokenInput: $('token-input'),
    toggleToken: $('toggle-token'),
    loginButton: $('login-button'),
    loginButtonLabel: $('login-button-label'),
    loginSpinner: $('login-spinner'),
    loginError: $('login-error'),

    appView: $('app-view'),
    homeButton: $('home-button'),
    guildList: $('guild-list'),
    railStatus: $('rail-status'),
    sidebarTitle: $('sidebar-title'),
    connectionPill: $('connection-pill'),
    connectionLabel: $('connection-label'),
    channelList: $('channel-list'),
    accountAvatar: $('account-avatar'),
    accountName: $('account-name'),
    accountHandle: $('account-handle'),
    logoutButton: $('logout-button'),

    chatEmpty: $('chat-empty'),
    emptyTitle: $('empty-title'),
    emptyText: $('empty-text'),
    chatActive: $('chat-active'),
    mobileBack: $('mobile-back'),
    chatChannelIcon: $('chat-channel-icon'),
    chatTitle: $('chat-title'),
    chatTopic: $('chat-topic'),
    chatStatus: $('chat-status'),
    chatStatusLabel: $('chat-status-label'),

    messageScroll: $('message-scroll'),
    loadOlderWrap: $('load-older-wrap'),
    loadOlderButton: $('load-older-button'),
    messageList: $('message-list'),
    messageLoading: $('message-loading'),
    channelEnd: $('channel-end'),
    channelEndLabel: $('channel-end-label'),
    jumpBottomWrap: $('jump-bottom-wrap'),
    jumpBottomButton: $('jump-bottom'),

    typingBar: $('typing-bar'),
    typingText: $('typing-text'),
    replyBar: $('reply-bar'),
    replyAuthor: $('reply-author'),
    replyPreview: $('reply-preview'),
    cancelReply: $('cancel-reply'),

    composer: $('composer'),
    messageInput: $('message-input'),
    sendButton: $('send-button'),
    charCount: $('char-count'),
    composerHint: $('composer-hint'),

    toastContainer: $('toast-container'),
  };

  const state = {
    token: null,
    me: null,
    authInProgress: false,

    guilds: [],
    dms: [],
    guildChannels: new Map(),
    guildChannelRequests: new Map(),
    channelGuildIds: new Map(),
    lastChannelByGuild: new Map(),
    collapsedCategories: new Set(),

    mode: 'home',
    selectedGuildId: null,
    currentChannel: null,
    replyTo: null,
    sending: false,

    messageStores: new Map(),
    activeRequestId: 0,

    socket: null,
    socketGeneration: 0,
    reconnectTimer: null,
    reconnectAttempt: 0,
    gatewayStatus: 'offline',
    explicitlyClosed: true,
    lastSocketMessage: '',

    typingByChannel: new Map(),
    unreadChannels: new Set(),
    newMessagesBelow: false,
    lastTypingSent: 0,
  };

  const icons = {
    reply: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M15 3.5h-6L7.5 5H3v2h18V5h-4.5L15 3.5ZM5 9v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9H5Zm4 11H7V11h2v9Zm4 0h-2V11h2v9Zm4 0h-2V11h2v9Z"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 15.4-7-7L6.4 7l5.6 5.6L17.6 7 19 8.4l-7 7Z"/></svg>',
    file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm4 18H6V4h7v5h5v11Z"/></svg>',
  };

  // ---------------------------------------------------------------------------
  // Small utilities
  // ---------------------------------------------------------------------------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function removeStorage(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // localStorage can be unavailable in private browsing modes.
    }
  }

  function isMobile() {
    return window.matchMedia('(max-width: 760px)').matches;
  }

  function compareSnowflakes(a, b) {
    try {
      const left = BigInt(a);
      const right = BigInt(b);
      return left < right ? -1 : left > right ? 1 : 0;
    } catch {
      return String(a ?? '').localeCompare(String(b ?? ''));
    }
  }

  function displayName(user) {
    if (!user) return 'Unknown User';
    return user.global_name || user.display_name || user.username || 'Unknown User';
  }

  function memberName(message) {
    return message?.member?.nick || displayName(message?.author);
  }

  function handleFor(user) {
    if (!user) return '';
    if (user.discriminator && user.discriminator !== '0') {
      return `${user.username}#${user.discriminator}`;
    }
    return user.username ? `@${user.username}` : '';
  }

  function initials(name, fallback = '?') {
    const clean = String(name || '')
      .replace(/[^\p{L}\p{N} ]/gu, ' ')
      .trim();
    if (!clean) return fallback;
    const words = clean.split(/\s+/);
    if (words.length > 1) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return Array.from(words[0]).slice(0, 2).join('').toUpperCase();
  }

  function avatarColor(id) {
    const source = String(id || '0');
    let hash = 0;
    for (let i = 0; i < source.length; i += 1) {
      hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
    }
    return hash % 6;
  }

  function avatarUrl(user, size = 64) {
    if (!user?.id) return null;
    if (user.avatar) {
      return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=${size}`;
    }
    let index = 0;
    try {
      index = Number((BigInt(user.id) >> 22n) % 6n);
    } catch {
      index = 0;
    }
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  }

  function fillAvatar(container, user, sizeClass = 'avatar-32') {
    if (!container) return;
    container.textContent = '';
    container.className = `avatar ${sizeClass} avatar-fallback avatar-color-${avatarColor(user?.id)}`;

    const url = avatarUrl(user, sizeClass === 'avatar-48' ? 128 : 64);
    if (url) {
      const image = new Image();
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.referrerPolicy = 'no-referrer';
      image.src = url;
      image.addEventListener('error', () => {
        image.remove();
        container.textContent = initials(displayName(user));
      });
      container.appendChild(image);
    } else {
      container.textContent = initials(displayName(user));
    }
  }

  function createAvatar(user, sizeClass = 'avatar-32') {
    const container = el('span', `avatar ${sizeClass} avatar-fallback`);
    fillAvatar(container, user, sizeClass);
    return container;
  }

  function guildIconUrl(guild) {
    if (!guild?.icon) return null;
    return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.webp?size=96`;
  }

  function createGuildIcon(guild) {
    const wrapper = el('span', 'guild-icon');
    const fallback = el('span', 'guild-initials', initials(guild?.name, '#'));
    fallback.classList.add(`guild-color-${avatarColor(guild?.id)}`);
    wrapper.appendChild(fallback);

    const url = guildIconUrl(guild);
    if (url) {
      const image = new Image();
      image.alt = '';
      image.className = 'guild-image';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.referrerPolicy = 'no-referrer';
      image.src = url;
      image.addEventListener('load', () => {
        fallback.hidden = true;
      });
      image.addEventListener('error', () => {
        image.remove();
        fallback.hidden = false;
      });
      wrapper.appendChild(image);
    }

    return wrapper;
  }

  function privateRecipients(channel) {
    return Array.isArray(channel?.recipients) ? channel.recipients.filter(Boolean) : [];
  }

  function privateChannelName(channel) {
    if (!channel) return 'Direct Message';
    if (channel.type === 3) {
      return (
        channel.name ||
        privateRecipients(channel)
          .map((user) => displayName(user))
          .join(', ') ||
        'Group DM'
      );
    }
    const recipient = privateRecipients(channel)[0];
    return recipient ? displayName(recipient) : channel.name || 'Direct Message';
  }

  function privateChannelIconUrl(channel) {
    if (!channel?.icon || channel.type !== 3) return null;
    return `https://cdn.discordapp.com/channel-icons/${channel.id}/${channel.icon}.webp?size=64`;
  }

  function fillChannelAvatar(container, channel, sizeClass = 'avatar-24') {
    if (!container) return;
    container.textContent = '';

    if (channel?.type === 3) {
      const name = privateChannelName(channel);
      container.className = `avatar ${sizeClass} avatar-fallback avatar-color-${avatarColor(channel.id)}`;
      const url = privateChannelIconUrl(channel);
      if (url) {
        const image = new Image();
        image.alt = '';
        image.loading = 'lazy';
        image.src = url;
        image.addEventListener('error', () => {
          image.remove();
          container.textContent = initials(name);
        });
        container.appendChild(image);
      } else {
        container.textContent = initials(name);
      }
      return;
    }

    const recipient = privateRecipients(channel)[0];
    fillAvatar(container, recipient, sizeClass);
  }

  function createChannelAvatar(channel, sizeClass = 'avatar-24') {
    const container = el('span', `avatar ${sizeClass} avatar-fallback`);
    fillChannelAvatar(container, channel, sizeClass);
    return container;
  }

  function formatTime(date) {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }

  function formatFullDate(date) {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(date);
  }

  function dateSeparatorLabel(date) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const difference = Math.round((today - target) / 86_400_000);
    if (difference === 0) return 'Today';
    if (difference === 1) return 'Yesterday';
    return new Intl.DateTimeFormat(undefined, {
      month: 'long',
      day: 'numeric',
      year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
    }).format(date);
  }

  function dayKey(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }

  function messagePreview(message) {
    let content = String(message?.content || '');
    content = content
      .replace(/```[\s\S]*?```/g, '[code]')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_~]+/g, '')
      .replace(/\|\|/g, '')
      .replace(/^>\s?/gm, '')
      .replace(/<@!?(\d+)>/g, '@user')
      .replace(/<#(\d+)>/g, '#channel')
      .replace(/<a?:[A-Za-z0-9_~]+:\d+>/g, ':emoji:')
      .replace(/\s+/g, ' ')
      .trim();

    if (content) return content.length > 90 ? `${content.slice(0, 90)}…` : content;
    if (message?.attachments?.length) return '[Attachment]';
    if (message?.embeds?.length) return '[Embed]';
    return '[Message]';
  }

  function messageAuthorName(message) {
    return memberName(message);
  }

  function isDiscordCdn(url) {
    try {
      const parsed = new URL(url);
      return (
        parsed.protocol === 'https:' &&
        (parsed.hostname === 'cdn.discordapp.com' ||
          parsed.hostname === 'media.discordapp.net')
      );
    } catch {
      return false;
    }
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function toast(message, type = 'info', duration = 5000) {
    const node = el('div', `toast ${type}`);
    node.appendChild(el('span', 'toast-text', message));
    dom.toastContainer.appendChild(node);
    setTimeout(() => {
      node.classList.add('leaving');
      setTimeout(() => node.remove(), 180);
    }, duration);
  }

  function friendlyError(error) {
    if (!error) return 'Something went wrong.';
    if (error.name === 'TypeError') {
      return 'Could not reach the local server. Make sure it is still running.';
    }
    if (error.status === 429 && error.retryAfter) {
      return `You are being rate limited. Try again in ${Math.ceil(error.retryAfter)}s.`;
    }
    return error.message || 'Something went wrong.';
  }

  // ---------------------------------------------------------------------------
  // Discord REST client (through the local proxy)
  // ---------------------------------------------------------------------------

  async function request(path, token, options = {}) {
    const method = options.method || 'GET';
    const headers = {
      Accept: 'application/json',
      'X-Discord-Token': token,
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let response;
    try {
      response = await fetch(`/api${path}`, {
        method,
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      const error = new Error(
        'Could not reach the local server. Make sure it is still running.',
      );
      error.name = 'TypeError';
      throw error;
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
      const error = new Error(
        (data && (data.error || data.message)) ||
          `Request failed (HTTP ${response.status}).`,
      );
      error.status = response.status;
      error.code = data && data.code;
      error.retryAfter =
        (data && data.retry_after) ||
        Number(response.headers.get('retry-after')) ||
        null;
      throw error;
    }

    return data;
  }

  function api(path, options) {
    if (!state.token) {
      return Promise.reject(new Error('You are not signed in.'));
    }
    return request(path, state.token, options);
  }

  // ---------------------------------------------------------------------------
  // Safe subset of Discord markdown
  // ---------------------------------------------------------------------------

  function renderMarkdown(raw, context = {}) {
    if (typeof raw !== 'string' || !raw) return '';

    const tokens = [];
    const stash = (html) => {
      const index = tokens.push(html) - 1;
      return `\uE000${index}\uE001`;
    };

    const mentionMap = new Map(
      (context.mentions || [])
        .filter((user) => user && user.id)
        .map((user) => [String(user.id), user]),
    );

    let text = raw.replace(/[\uE000-\uF8FF]/g, '');

    // Fenced code blocks
    text = text.replace(
      /(```|~~~)([^\n]*)\n?([\s\S]*?)\1/g,
      (_match, _fence, language, code) => {
        const cleanLanguage = String(language || '')
          .trim()
          .split(/\s+/)[0]
          .replace(/[^\w+#.-]/g, '')
          .slice(0, 24);
        const languageClass = cleanLanguage
          ? ` class="language-${escapeHtml(cleanLanguage)}"`
          : '';
        return stash(`<pre><code${languageClass}>${escapeHtml(code)}</code></pre>`);
      },
    );

    // Inline code
    text = text.replace(/`([^`\n]+)`/g, (_match, code) => {
      return stash(`<code>${escapeHtml(code)}</code>`);
    });

    // Masked links: [label](https://example.com)
    text = text.replace(
      /\[([^\]\n]{1,300})\]\((https?:\/\/[^\s)]+)\)/g,
      (_match, label, rawUrl) => {
        const href = rawUrl.trim();
        if (!/^https?:\/\//i.test(href)) return _match;
        return stash(
          `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`,
        );
      },
    );

    // Bare links. They become placeholders so markdown cannot corrupt the HTML.
    text = text.replace(/https?:\/\/[^\s<>"']+/gi, (rawUrl) => {
      let url = rawUrl;
      let suffix = '';

      const trailing = url.match(/[.,!?;:]+$/);
      if (trailing) {
        suffix = trailing[0] + suffix;
        url = url.slice(0, -trailing[0].length);
      }

      while (url.endsWith(')')) {
        const opens = (url.match(/\(/g) || []).length;
        const closes = (url.match(/\)/g) || []).length;
        if (closes <= opens) break;
        suffix = ')' + suffix;
        url = url.slice(0, -1);
      }

      if (!/^https?:\/\//i.test(url)) return rawUrl;
      return (
        stash(
          `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`,
        ) + suffix
      );
    });

    // User mentions
    text = text.replace(/<@!?(\d{5,25})>/g, (_match, id) => {
      const user = mentionMap.get(id);
      const name = user ? displayName(user) : 'user';
      return stash(`<span class="mention">@${escapeHtml(name)}</span>`);
    });

    // Role mentions (role names are not always available without extra data)
    text = text.replace(/<@&(\d{5,25})>/g, () => {
      return stash('<span class="mention">@role</span>');
    });

    // Channel mentions
    text = text.replace(/<#(\d{5,25})>/g, (_match, id) => {
      let name = null;
      if (typeof context.lookupChannel === 'function') {
        name = context.lookupChannel(id);
      }
      return stash(
        `<span class="mention">#${escapeHtml(name || 'channel')}</span>`,
      );
    });

    // Custom emoji
    text = text.replace(
      /<(a?):([A-Za-z0-9_~]+):(\d{5,25})>/g,
      (_match, animated, name, id) => {
        const extension = animated ? 'gif' : 'webp';
        return stash(
          `<img class="custom-emoji" src="https://cdn.discordapp.com/emojis/${id}.${extension}?size=24" alt=":${escapeHtml(name)}:" title=":${escapeHtml(name)}:" loading="lazy">`,
        );
      },
    );

    // Discord timestamps
    text = text.replace(
      /<t:(\d{1,16})(?::([tTdDfFR]))?>/g,
      (_match, seconds, style = 'f') => {
        const date = new Date(Number(seconds) * 1000);
        if (Number.isNaN(date.getTime())) return _match;
        const formatters = {
          t: { timeStyle: 'short' },
          T: { timeStyle: 'medium' },
          d: { dateStyle: 'short' },
          D: { dateStyle: 'long' },
          f: { dateStyle: 'short', timeStyle: 'short' },
          F: { dateStyle: 'full', timeStyle: 'short' },
        };
        let label;
        if (style === 'R') {
          const diff = Math.round((date.getTime() - Date.now()) / 1000);
          const formatter = new Intl.RelativeTimeFormat(undefined, {
            numeric: 'auto',
          });
          if (Math.abs(diff) < 60) label = formatter.format(diff, 'second');
          else if (Math.abs(diff) < 3600) {
            label = formatter.format(Math.round(diff / 60), 'minute');
          } else if (Math.abs(diff) < 86_400) {
            label = formatter.format(Math.round(diff / 3600), 'hour');
          } else {
            label = formatter.format(Math.round(diff / 86_400), 'day');
          }
        } else {
          label = new Intl.DateTimeFormat(
            undefined,
            formatters[style] || formatters.f,
          ).format(date);
        }
        return stash(`<span class="message-timestamp">${escapeHtml(label)}</span>`);
      },
    );

    text = escapeHtml(text);

    // Underline must be handled before single-underscore italics.
    text = text.replace(/__(.+?)__/g, '<u>$1</u>');
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/~~(.+?)~~/g, '<s>$1</s>');
    text = text.replace(
      /\|\|(.+?)\|\|/g,
      '<span class="spoiler" role="button" tabindex="0">$1</span>',
    );
    text = text.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
    text = text.replace(
      /(^|[\s(])_([^_\n]+?)_(?=$|[\s).,!?])/g,
      '$1<em>$2</em>',
    );
    text = text.replace(
      /(^|[\s])(@(?:everyone|here))\b/g,
      '$1<span class="mention">$2</span>',
    );

    // Blockquotes are intentionally simple: one quote line per blockquote.
    const lines = text.split('\n');
    const renderedLines = lines.map((line) => {
      if (line.startsWith('&gt; ')) {
        return `<blockquote>${line.slice(5)}</blockquote>`;
      }
      if (line === '&gt;') return '<blockquote></blockquote>';
      return line;
    });
    text = renderedLines.join('<br>');

    return text.replace(/\uE000(\d+)\uE001/g, (_match, index) => {
      return tokens[Number(index)] ?? '';
    });
  }

  // ---------------------------------------------------------------------------
  // Authentication and session
  // ---------------------------------------------------------------------------

  function setLoginLoading(loading, label = 'Log in') {
    dom.loginButton.disabled = loading;
    dom.tokenInput.disabled = loading;
    dom.toggleToken.disabled = loading;
    dom.loginButtonLabel.textContent = loading ? label : 'Log in';
    dom.loginSpinner.hidden = !loading;
  }

  function showLoginError(message) {
    dom.loginError.textContent = message;
    dom.loginError.hidden = !message;
  }

  function loginErrorMessage(error) {
    if (error.status === 401) {
      return 'Discord rejected that token. Check that you copied the whole token and try again.';
    }
    if (error.status === 403) {
      return 'Discord refused access with this token.';
    }
    if (error.status === 429) {
      return 'You are being rate limited. Wait a moment, then try again.';
    }
    return friendlyError(error);
  }

  async function authenticate(rawToken, options = {}) {
    if (state.authInProgress) return;

    const token = String(rawToken || '').trim();
    if (!token) {
      showLoginError('Paste your Discord account token to continue.');
      dom.tokenInput.focus();
      return;
    }

    state.authInProgress = true;
    showLoginError('');
    setLoginLoading(true, options.auto ? 'Signing in…' : 'Connecting…');

    try {
      const user = await request('/me', token);
      if (!user?.id) throw new Error('Discord did not return an account.');

      if (!writeStorage(TOKEN_KEY, token)) {
        toast(
          'Signed in, but the token could not be saved to localStorage.',
          'error',
        );
      }

      state.authInProgress = false;
      setLoginLoading(false);
      startSession(token, user);
    } catch (error) {
      state.authInProgress = false;
      setLoginLoading(false);

      if (error.status === 401) {
        removeStorage(TOKEN_KEY);
        dom.tokenInput.value = '';
      } else {
        dom.tokenInput.value = token;
      }

      showLoginError(loginErrorMessage(error));
      dom.tokenInput.focus();
    }
  }

  function startSession(token, user) {
    state.token = token;
    state.me = user;
    state.explicitlyClosed = false;
    state.mode = 'home';
    state.selectedGuildId = null;
    state.currentChannel = null;
    state.replyTo = null;
    state.gatewayStatus = 'offline';
    state.reconnectAttempt = 0;
    state.unreadChannels.clear();
    state.channelGuildIds.clear();
    state.guildChannels.clear();
    state.guildChannelRequests.clear();
    state.lastChannelByGuild.clear();
    state.messageStores.clear();
    state.dms = [];
    state.guilds = [];

    dom.loginView.hidden = true;
    dom.appView.hidden = false;
    dom.chatEmpty.hidden = false;
    dom.chatActive.hidden = true;
    dom.emptyTitle.textContent = 'Welcome back';
    dom.emptyText.textContent = 'Loading your servers and messages…';
    dom.channelList.replaceChildren(
      el('div', 'sidebar-empty', 'Loading channels…'),
    );
    dom.guildList.replaceChildren();
    dom.messageList.replaceChildren();
    dom.messageScroll.scrollTop = 0;

    renderAccount();
    renderGuilds();
    setGatewayStatus('connecting');
    connectGateway();

    initializeWorkspace().catch((error) => {
      toast(friendlyError(error), 'error');
    });
  }

  async function initializeWorkspace() {
    const results = await Promise.allSettled([
      api('/guilds'),
      api('/private-channels'),
    ]);

    if (results[0].status === 'fulfilled') {
      state.guilds = Array.isArray(results[0].value) ? results[0].value : [];
    } else {
      toast(`Could not load servers: ${friendlyError(results[0].reason)}`, 'error');
    }

    if (results[1].status === 'fulfilled') {
      state.dms = (Array.isArray(results[1].value) ? results[1].value : []).filter(
        (channel) => channel && (channel.type === 1 || channel.type === 3),
      );
    } else {
      toast(
        `Could not load direct messages: ${friendlyError(results[1].reason)}`,
        'error',
      );
    }

    renderAccount();
    renderGuilds();
    renderSidebar();

    const savedChannelId = readStorage(LAST_CHANNEL_KEY);
    const savedGuildId = readStorage(LAST_GUILD_KEY);

    if (savedChannelId) {
      const savedDm = state.dms.find((channel) => channel.id === savedChannelId);
      if (savedDm) {
        if (savedGuildId) removeStorage(LAST_GUILD_KEY);
        openChannel(savedDm, { fromSidebar: false });
        return;
      }
    }

    if (savedGuildId && state.guilds.some((guild) => guild.id === savedGuildId)) {
      await selectGuild(savedGuildId, {
        preferredChannelId: savedChannelId || null,
        fromRail: false,
        openOnMobile: true,
      });
      return;
    }

    if (state.guilds.length > 0) {
      await selectGuild(state.guilds[0].id, {
        fromRail: false,
        openOnMobile: true,
      });
      return;
    }

    if (state.dms.length > 0) {
      state.mode = 'home';
      state.selectedGuildId = null;
      renderGuilds();
      renderSidebar();
      showEmptyView(
        'Direct Messages',
        'Choose a conversation from the sidebar to start chatting.',
      );
      return;
    }

    showEmptyView(
      'No servers yet',
      'This account is not in any servers and has no direct messages to show.',
      false,
    );
  }

  function resetWorkspaceUi() {
    dom.guildList.replaceChildren();
    dom.channelList.replaceChildren();
    dom.messageList.replaceChildren();
    dom.messageLoading.hidden = true;
    dom.loadOlderWrap.hidden = true;
    dom.channelEnd.hidden = true;
    dom.jumpBottomWrap.hidden = true;
    dom.replyBar.hidden = true;
    dom.typingBar.classList.add('no-typing');
    dom.typingText.textContent = '';
    dom.chatActive.hidden = true;
    dom.chatEmpty.hidden = false;
    dom.appView.classList.remove('chat-open');
    dom.messageInput.value = '';
    dom.messageInput.style.height = '';
    dom.chatChannelIcon.className = 'channel-hash';
    dom.chatChannelIcon.textContent = '#';
    dom.chatTitle.textContent = 'channel';
    dom.chatTopic.textContent = '';
    dom.accountName.textContent = '';
    dom.accountHandle.textContent = '';
    dom.accountAvatar.textContent = '?';
    dom.accountAvatar.className = 'avatar avatar-32 avatar-fallback';
    document.title = 'Discord Web Client';
  }

  function performLogout(options = {}) {
    const message = options.message || '';

    state.explicitlyClosed = true;
    state.socketGeneration += 1;
    if (state.socket) {
      try {
        state.socket.close(1000, 'Logged out');
      } catch {
        // Already closed.
      }
      state.socket = null;
    }
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }

    for (const typingMap of state.typingByChannel.values()) {
      for (const entry of typingMap.values()) {
        clearTimeout(entry.timer);
      }
    }

    state.token = null;
    state.me = null;
    state.authInProgress = false;
    state.guilds = [];
    state.dms = [];
    state.guildChannels.clear();
    state.guildChannelRequests.clear();
    state.channelGuildIds.clear();
    state.lastChannelByGuild.clear();
    state.messageStores.clear();
    state.typingByChannel.clear();
    state.unreadChannels.clear();
    state.collapsedCategories.clear();
    state.currentChannel = null;
    state.selectedGuildId = null;
    state.mode = 'home';
    state.replyTo = null;
    state.sending = false;
    state.activeRequestId += 1;
    state.newMessagesBelow = false;

    removeStorage(TOKEN_KEY);
    removeStorage(LAST_CHANNEL_KEY);
    removeStorage(LAST_GUILD_KEY);

    resetWorkspaceUi();
    dom.appView.hidden = true;
    dom.loginView.hidden = false;
    dom.tokenInput.value = '';
    setLoginLoading(false);
    showLoginError(message);
    setGatewayStatus('offline');

    window.setTimeout(() => {
      if (!dom.loginView.hidden) dom.tokenInput.focus();
    }, 30);
  }

  // ---------------------------------------------------------------------------
  // Gateway connection relay
  // ---------------------------------------------------------------------------

  function setGatewayStatus(status) {
    state.gatewayStatus = status;

    const dotClass =
      status === 'online'
        ? 'status-dot online'
        : status === 'offline'
          ? 'status-dot offline'
          : 'status-dot';

    const railDot = dom.railStatus.querySelector('.status-dot');
    if (railDot) railDot.className = dotClass;

    const pillDot = dom.connectionPill.querySelector('.status-dot');
    if (pillDot) pillDot.className = dotClass;

    const chatDot = dom.chatStatus.querySelector('.status-dot');
    if (chatDot) chatDot.className = dotClass;

    const label =
      status === 'online'
        ? 'Live'
        : status === 'connecting'
          ? 'Connecting'
          : 'Offline';
    dom.connectionLabel.textContent = label;
    dom.chatStatusLabel.textContent = label;
    dom.railStatus.title =
      status === 'online'
        ? 'Gateway connected'
        : status === 'connecting'
          ? 'Connecting to Discord…'
          : 'Gateway offline';
    dom.connectionPill.title = dom.railStatus.title;
    dom.chatStatus.title = dom.railStatus.title;
  }

  function connectGateway() {
    if (!state.token || state.explicitlyClosed) return;

    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }

    state.socketGeneration += 1;
    const generation = state.socketGeneration;

    if (state.socket) {
      try {
        state.socket.close();
      } catch {
        // Ignore.
      }
      state.socket = null;
    }

    setGatewayStatus('connecting');
    state.lastSocketMessage = '';

    let socket;
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/gateway`);
    } catch {
      setGatewayStatus('offline');
      scheduleGatewayReconnect();
      return;
    }

    state.socket = socket;
    let hadReady = false;

    socket.addEventListener('open', () => {
      if (generation !== state.socketGeneration) return;
      socket.send(JSON.stringify({ type: 'auth', token: state.token }));
    });

    socket.addEventListener('message', (event) => {
      if (generation !== state.socketGeneration) return;

      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }

      if (!payload || typeof payload !== 'object') return;

      if (payload.type === 'ready') {
        const reconnected = hadReady;
        hadReady = true;
        state.reconnectAttempt = 0;
        state.lastSocketMessage = '';

        if (payload.user?.id) {
          state.me = { ...(state.me || {}), ...payload.user };
          renderAccount();
        }

        setGatewayStatus('online');

        if (reconnected) {
          refreshActiveMessages();
        }
        return;
      }

      if (payload.type === 'dispatch') {
        if (typeof payload.event === 'string') {
          handleGatewayDispatch(payload.event, payload.data);
        }
        return;
      }

      if (payload.type === 'closed') {
        state.lastSocketMessage =
          payload.message || 'The Discord gateway connection closed.';
        setGatewayStatus('offline');
        return;
      }

      if (payload.type === 'error') {
        if (payload.fatal) {
          forceLogout(
            payload.message ||
              'The Discord gateway rejected this session. Please sign in again.',
          );
        } else {
          state.lastSocketMessage = payload.message || '';
          setGatewayStatus('offline');
        }
      }
    });

    socket.addEventListener('close', () => {
      if (generation !== state.socketGeneration) return;
      state.socket = null;
      if (state.explicitlyClosed || !state.token) return;

      setGatewayStatus('offline');
      scheduleGatewayReconnect();
    });

    socket.addEventListener('error', () => {
      // The close event will handle reconnecting or showing the failure.
    });
  }

  function scheduleGatewayReconnect() {
    if (
      state.reconnectTimer ||
      state.explicitlyClosed ||
      !state.token ||
      state.authInProgress
    ) {
      return;
    }

    const attempt = state.reconnectAttempt++;
    const delay = Math.min(25_000, 1000 * 2 ** Math.min(attempt, 5));
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      if (!state.explicitlyClosed && state.token) connectGateway();
    }, delay + Math.floor(Math.random() * 400));
  }

  function handleGatewayDispatch(event, data) {
    if (!data) return;

    switch (event) {
      case 'MESSAGE_CREATE':
        handleMessageCreate(data);
        break;
      case 'MESSAGE_UPDATE':
        handleMessageUpdate(data);
        break;
      case 'MESSAGE_DELETE':
        handleMessageDelete(data);
        break;
      case 'MESSAGE_DELETE_BULK':
        handleMessageDeleteBulk(data);
        break;
      case 'TYPING_START':
        handleTypingStart(data);
        break;
      case 'CHANNEL_CREATE':
        handleChannelCreate(data);
        break;
      case 'CHANNEL_UPDATE':
        handleChannelUpdate(data);
        break;
      case 'CHANNEL_DELETE':
        handleChannelDelete(data);
        break;
      case 'GUILD_CREATE':
        handleGuildCreate(data);
        break;
      case 'GUILD_UPDATE':
        handleGuildUpdate(data);
        break;
      case 'GUILD_DELETE':
        handleGuildDelete(data);
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Navigation and sidebars
  // ---------------------------------------------------------------------------

  function renderAccount() {
    if (!state.me) return;
    fillAvatar(dom.accountAvatar, state.me, 'avatar-32');
    dom.accountName.textContent = displayName(state.me);
    dom.accountHandle.textContent = handleFor(state.me);
  }

  function getUnreadGuildIds() {
    const guilds = new Set();
    for (const channelId of state.unreadChannels) {
      const guildId = state.channelGuildIds.get(channelId);
      if (guildId) guilds.add(guildId);
    }
    return guilds;
  }

  function hasUnreadDirectMessage() {
    for (const channelId of state.unreadChannels) {
      if (!state.channelGuildIds.get(channelId)) return true;
    }
    return false;
  }

  function updateDocumentTitle() {
    document.title = state.unreadChannels.size
      ? `(${state.unreadChannels.size}) Discord Web Client`
      : 'Discord Web Client';
  }

  function renderGuilds() {
    const unreadGuilds = getUnreadGuildIds();
    dom.guildList.replaceChildren();

    const homeUnread = dom.homeButton.querySelector('.rail-unread');
    if (homeUnread) homeUnread.remove();
    if (hasUnreadDirectMessage()) {
      const dot = el('span', 'rail-unread');
      dot.setAttribute('aria-label', 'Unread direct messages');
      dom.homeButton.appendChild(dot);
    }

    const homeActive = state.mode !== 'guild';
    dom.homeButton.classList.toggle('active', homeActive);
    if (homeActive) dom.homeButton.setAttribute('aria-current', 'true');
    else dom.homeButton.removeAttribute('aria-current');

    for (const guild of state.guilds) {
      const button = el('button', 'rail-button guild-button');
      button.type = 'button';
      button.dataset.guildId = guild.id;
      button.title = guild.name || 'Server';
      button.setAttribute('aria-label', guild.name || 'Server');

      const active =
        state.mode === 'guild' && state.selectedGuildId === guild.id;
      if (active) {
        button.classList.add('active');
        button.setAttribute('aria-current', 'true');
      }

      button.appendChild(createGuildIcon(guild));

      if (unreadGuilds.has(guild.id)) {
        const dot = el('span', 'rail-unread');
        dot.setAttribute('aria-label', 'Unread messages');
        button.appendChild(dot);
      }

      button.addEventListener('click', () => {
        selectGuild(guild.id, { fromRail: true }).catch((error) => {
          toast(friendlyError(error), 'error');
        });
      });

      dom.guildList.appendChild(button);
    }

    updateDocumentTitle();
  }

  function renderSidebar() {
    dom.channelList.replaceChildren();

    if (state.mode === 'guild') {
      const guild = state.guilds.find(
        (candidate) => candidate.id === state.selectedGuildId,
      );
      dom.sidebarTitle.textContent = guild?.name || 'Server';
      renderGuildSidebar();
    } else {
      dom.sidebarTitle.textContent = 'Direct Messages';
      renderDmSidebar();
    }
  }

  function createCategory(label, key, channels) {
    const collapsed = state.collapsedCategories.has(key);
    const heading = el('button', 'channel-category');
    heading.type = 'button';
    heading.innerHTML = icons.chevron;
    heading.appendChild(document.createTextNode(label));
    heading.setAttribute('aria-expanded', String(!collapsed));
    if (collapsed) heading.classList.add('collapsed');

    const group = el('div', 'channel-group');
    group.hidden = collapsed;

    for (const channel of channels) {
      group.appendChild(createGuildChannelRow(channel));
    }

    heading.addEventListener('click', () => {
      const isCollapsed = state.collapsedCategories.has(key);
      if (isCollapsed) state.collapsedCategories.delete(key);
      else state.collapsedCategories.add(key);
      const nowCollapsed = !isCollapsed;
      heading.classList.toggle('collapsed', nowCollapsed);
      heading.setAttribute('aria-expanded', String(!nowCollapsed));
      group.hidden = nowCollapsed;
    });

    dom.channelList.appendChild(heading);
    dom.channelList.appendChild(group);
  }

  function renderGuildSidebar() {
    const guildId = state.selectedGuildId;
    const channels = state.guildChannels.get(guildId);

    if (!channels) {
      if (state.guildChannelRequests.has(guildId)) {
        const loader = el('div', 'sidebar-loading');
        loader.appendChild(el('span', 'spinner'));
        loader.appendChild(document.createTextNode('Loading channels…'));
        dom.channelList.appendChild(loader);
      } else {
        dom.channelList.appendChild(
          el('div', 'sidebar-empty', 'Could not load channels.'),
        );
      }
      return;
    }

    const sorted = [...channels].sort(
      (left, right) => (left.position ?? 0) - (right.position ?? 0),
    );
    const categories = sorted.filter((channel) => channel.type === 4);
    const textChannels = sorted.filter(
      (channel) => channel.type === 0 || channel.type === 5,
    );

    if (textChannels.length === 0) {
      dom.channelList.appendChild(
        el('div', 'sidebar-empty', 'There are no text channels you can view.'),
      );
      return;
    }

    const categoryIds = new Set(categories.map((category) => category.id));
    const orphanChannels = textChannels.filter(
      (channel) => !channel.parent_id || !categoryIds.has(channel.parent_id),
    );

    for (const category of categories) {
      const children = textChannels.filter(
        (channel) => channel.parent_id === category.id,
      );
      if (children.length === 0) continue;
      createCategory(category.name || 'Channels', `category-${category.id}`, children);
    }

    if (orphanChannels.length > 0) {
      const key = categories.length ? '__uncategorized' : '__text_channels';
      createCategory('Text Channels', key, orphanChannels);
    }
  }

  function createGuildChannelRow(channel) {
    const button = el('button', 'channel-button');
    button.type = 'button';
    button.dataset.channelId = channel.id;
    button.title = `#${channel.name || 'channel'}`;
    const active = state.currentChannel?.id === channel.id;
    if (active) {
      button.classList.add('active');
      button.setAttribute('aria-current', 'page');
    }

    button.appendChild(el('span', 'channel-hash', '#'));
    button.appendChild(el('span', 'channel-name', channel.name || 'channel'));

    if (state.unreadChannels.has(channel.id) && !active) {
      button.appendChild(el('span', 'channel-unread'));
    }

    button.addEventListener('click', () => {
      openChannel(channel, { fromSidebar: true }).catch((error) => {
        toast(friendlyError(error), 'error');
      });
    });

    return button;
  }

  function sortedDms() {
    return [...state.dms].sort((left, right) => {
      const leftId = left.last_message_id || left.id;
      const rightId = right.last_message_id || right.id;
      return compareSnowflakes(rightId, leftId);
    });
  }

  function renderDmSidebar() {
    if (state.dms.length === 0) {
      dom.channelList.appendChild(
        el(
          'div',
          'sidebar-empty',
          'No direct messages yet. New conversations will appear here.',
        ),
      );
      return;
    }

    for (const channel of sortedDms()) {
      const button = el('button', 'channel-button dm-channel');
      button.type = 'button';
      button.dataset.channelId = channel.id;
      button.title = privateChannelName(channel);
      const active = state.currentChannel?.id === channel.id;
      if (active) {
        button.classList.add('active');
        button.setAttribute('aria-current', 'page');
      }

      button.appendChild(createChannelAvatar(channel, 'avatar-24'));
      button.appendChild(
        el('span', 'channel-name', privateChannelName(channel)),
      );

      if (state.unreadChannels.has(channel.id) && !active) {
        button.appendChild(el('span', 'channel-unread'));
      }

      button.addEventListener('click', () => {
        openChannel(channel, { fromSidebar: true }).catch((error) => {
          toast(friendlyError(error), 'error');
        });
      });

      dom.channelList.appendChild(button);
    }
  }

  function getTextableChannels(channels) {
    return [...channels]
      .filter((channel) => channel.type === 0 || channel.type === 5)
      .sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
  }

  async function loadGuildChannels(guildId, options = {}) {
    const cached = state.guildChannels.get(guildId);
    if (cached && !options.force) return cached;

    const pending = state.guildChannelRequests.get(guildId);
    if (pending) return pending;

    const promise = api(`/guilds/${encodeURIComponent(guildId)}/channels`)
      .then((channels) => {
        const list = Array.isArray(channels) ? channels : [];
        state.guildChannels.set(guildId, list);
        for (const channel of list) {
          state.channelGuildIds.set(channel.id, guildId);
        }
        return list;
      })
      .finally(() => {
        state.guildChannelRequests.delete(guildId);
        if (state.mode === 'guild' && state.selectedGuildId === guildId) {
          renderSidebar();
        }
      });

    state.guildChannelRequests.set(guildId, promise);
    if (state.mode === 'guild' && state.selectedGuildId === guildId) {
      renderSidebar();
    }

    return promise;
  }

  function showEmptyView(title, text, showHints = true) {
    dom.chatActive.hidden = true;
    dom.chatEmpty.hidden = false;
    dom.emptyTitle.textContent = title;
    dom.emptyText.textContent = text;
    const hints = document.querySelector('.empty-hints');
    if (hints) hints.hidden = !showHints;
  }

  function closeActiveChannel() {
    if (state.currentChannel) rememberActiveScroll();
    state.currentChannel = null;
    state.replyTo = null;
    dom.replyBar.hidden = true;
    dom.messageInput.value = '';
    dom.messageInput.style.height = '';
    dom.typingBar.classList.add('no-typing');
    dom.typingText.textContent = '';
    dom.appView.classList.remove('chat-open');
    updateComposerState();
  }

  function selectHome() {
    closeActiveChannel();
    state.mode = 'home';
    state.selectedGuildId = null;
    removeStorage(LAST_GUILD_KEY);
    removeStorage(LAST_CHANNEL_KEY);
    showEmptyView(
      'Direct Messages',
      'Choose a conversation from the sidebar to start chatting.',
    );
    renderGuilds();
    renderSidebar();
    dom.appView.classList.remove('chat-open');
  }

  async function selectGuild(guildId, options = {}) {
    const guild = state.guilds.find((candidate) => candidate.id === guildId);
    if (!guild) return;

    closeActiveChannel();
    state.mode = 'guild';
    state.selectedGuildId = guildId;
    state.replyTo = null;
    dom.appView.classList.remove('chat-open');
    renderGuilds();
    renderSidebar();
    showEmptyView(guild.name || 'Server', 'Loading channels…');

    let channels;
    try {
      channels = await loadGuildChannels(guildId);
    } catch (error) {
      if (state.mode === 'guild' && state.selectedGuildId === guildId) {
        renderSidebar();
        showEmptyView(
          guild.name || 'Server',
          'Could not load this server’s channels. Check your connection and try again.',
          false,
        );
      }
      throw error;
    }

    if (state.mode !== 'guild' || state.selectedGuildId !== guildId) return;

    renderSidebar();
    const textChannels = getTextableChannels(channels);
    const remembered =
      options.preferredChannelId ||
      state.lastChannelByGuild.get(guildId) ||
      (readStorage(LAST_GUILD_KEY) === guildId
        ? readStorage(LAST_CHANNEL_KEY)
        : null);

    const channel =
      textChannels.find((candidate) => candidate.id === remembered) ||
      textChannels[0] ||
      null;

    const shouldOpen = !isMobile() || options.openOnMobile === true;

    if (channel && shouldOpen) {
      await openChannel(channel, { fromSidebar: false });
      return;
    }

    state.currentChannel = null;
    state.replyTo = null;
    renderGuilds();
    renderSidebar();
    if (textChannels.length === 0) {
      showEmptyView(
        guild.name || 'Server',
        'This server has no text channels you can view.',
        false,
      );
    } else {
      showEmptyView(
        guild.name || 'Server',
        'Choose a channel from the sidebar to start chatting.',
      );
    }
  }

  async function openChannel(channel, options = {}) {
    if (!channel?.id) return;

    if (state.currentChannel && state.currentChannel.id !== channel.id) {
      rememberActiveScroll();
    }

    const isDm = channel.type === 1 || channel.type === 3;
    let guildId = null;
    if (!isDm) {
      if (channel.guild_id) guildId = channel.guild_id;
      else if (state.mode === 'guild') guildId = state.selectedGuildId;
    }

    state.currentChannel = channel;
    if (isDm) {
      state.mode = 'home';
      state.selectedGuildId = null;
      removeStorage(LAST_GUILD_KEY);
    } else {
      state.mode = 'guild';
      if (guildId) {
        state.selectedGuildId = guildId;
        state.channelGuildIds.set(channel.id, guildId);
        state.lastChannelByGuild.set(guildId, channel.id);
        writeStorage(LAST_GUILD_KEY, guildId);
      }
    }

    writeStorage(LAST_CHANNEL_KEY, channel.id);
    state.unreadChannels.delete(channel.id);
    state.replyTo = null;
    state.newMessagesBelow = false;
    dom.replyBar.hidden = true;
    dom.chatEmpty.hidden = true;
    dom.chatActive.hidden = false;
    dom.messageInput.value = '';
    dom.messageInput.style.height = '';
    updateComposerState();

    if (isDm) {
      fillChannelAvatar(dom.chatChannelIcon, channel, 'avatar-24');
      dom.chatTitle.textContent = privateChannelName(channel);
      dom.chatTopic.textContent = '';
      dom.messageInput.placeholder = `Message ${privateChannelName(channel)}`;
      dom.composerHint.textContent = 'Press Enter to send';
    } else {
      dom.chatChannelIcon.className = 'channel-hash';
      dom.chatChannelIcon.textContent = '#';
      dom.chatTitle.textContent = channel.name || 'channel';
      dom.chatTopic.textContent = channel.topic || '';
      dom.messageInput.placeholder = `Message #${channel.name || 'channel'}`;
      dom.composerHint.textContent = 'Press Enter to send';
    }

    if (isMobile()) dom.appView.classList.add('chat-open');
    else dom.appView.classList.remove('chat-open');

    renderGuilds();
    renderSidebar();
    updateDocumentTitle();

    const store = getMessageStore(channel.id);
    dom.jumpBottomWrap.hidden = true;
    dom.channelEnd.hidden = true;
    dom.loadOlderWrap.hidden = true;
    dom.typingBar.classList.add('no-typing');
    dom.typingText.textContent = '';

    if (store.loaded) {
      renderTimeline({
        bottom: store.wasAtBottom !== false,
        restoreScrollTop: store.scrollTop,
      });
      if (Date.now() - store.loadedAt > 45_000) {
        refreshActiveMessages();
      }
    } else {
      dom.messageList.replaceChildren();
      dom.messageLoading.hidden = false;
      await loadInitialMessages(channel);
    }

    renderTypingBar();

    if (!isMobile() && options.fromSidebar) {
      dom.messageInput.focus();
    }
  }

  function rememberActiveScroll() {
    const channel = state.currentChannel;
    if (!channel) return;
    const store = getMessageStore(channel.id);
    store.scrollTop = dom.messageScroll.scrollTop;
    store.wasAtBottom = isNearBottom();
  }

  function getMessageStore(channelId) {
    let store = state.messageStores.get(channelId);
    if (!store) {
      store = {
        items: [],
        loaded: false,
        loading: false,
        loadingOlder: false,
        hasMore: true,
        loadedAt: 0,
        scrollTop: 0,
        wasAtBottom: true,
      };
      state.messageStores.set(channelId, store);
    }
    return store;
  }

  // ---------------------------------------------------------------------------
  // Message history
  // ---------------------------------------------------------------------------

  function mergeMessages(existing, incoming) {
    const byId = new Map();
    for (const message of existing || []) {
      if (message?.id) byId.set(message.id, message);
    }
    for (const message of incoming || []) {
      if (!message?.id) continue;
      const previous = byId.get(message.id);
      byId.set(
        message.id,
        previous ? { ...previous, ...message } : message,
      );
    }
    return [...byId.values()].sort((left, right) =>
      compareSnowflakes(left.id, right.id),
    );
  }

  function upsertMessage(channelId, message) {
    if (!message?.id) return { message: null, created: false };
    const store = getMessageStore(channelId);
    const index = store.items.findIndex((item) => item.id === message.id);
    if (index >= 0) {
      store.items[index] = { ...store.items[index], ...message };
      return { message: store.items[index], created: false };
    }

    store.items.push(message);
    store.items.sort((left, right) => compareSnowflakes(left.id, right.id));
    return { message, created: true };
  }

  function removeMessage(channelId, messageId) {
    const store = getMessageStore(channelId);
    const index = store.items.findIndex((message) => message.id === messageId);
    if (index === -1) return false;
    store.items.splice(index, 1);
    return true;
  }

  function showMessageLoadError(channel, error) {
    if (state.currentChannel?.id !== channel.id) return;
    dom.messageLoading.hidden = true;
    dom.loadOlderWrap.hidden = true;
    dom.channelEnd.hidden = true;
    dom.jumpBottomWrap.hidden = true;

    const wrap = el('div', 'load-error');
    wrap.appendChild(el('strong', '', 'Messages could not load'));
    wrap.appendChild(el('span', '', friendlyError(error)));
    const retry = el('button', 'retry-button', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', () => {
      dom.messageLoading.hidden = false;
      loadInitialMessages(channel).catch(() => {});
    });
    wrap.appendChild(retry);
    dom.messageList.replaceChildren(wrap);
  }

  async function loadInitialMessages(channel) {
    const store = getMessageStore(channel.id);
    if (store.loading) return;

    store.loading = true;
    const requestId = ++state.activeRequestId;
    if (state.currentChannel?.id === channel.id) {
      dom.messageLoading.hidden = false;
      dom.loadOlderWrap.hidden = true;
      dom.channelEnd.hidden = true;
      dom.jumpBottomWrap.hidden = true;
    }

    try {
      const messages = await api(
        `/channels/${encodeURIComponent(channel.id)}/messages?limit=${MESSAGE_LIMIT}`,
      );
      const list = Array.isArray(messages) ? messages : [];
      const chronological = list.slice().reverse();
      store.items = mergeMessages([], chronological);
      store.loaded = true;
      store.loadedAt = Date.now();
      store.hasMore = list.length >= MESSAGE_LIMIT;
      store.oldest = store.items[0]?.id || null;
      store.wasAtBottom = true;

      if (
        requestId === state.activeRequestId &&
        state.currentChannel?.id === channel.id
      ) {
        dom.messageList.replaceChildren();
        renderTimeline({ bottom: true });
      }
    } catch (error) {
      if (state.currentChannel?.id === channel.id) {
        showMessageLoadError(channel, error);
        toast(`Could not load messages: ${friendlyError(error)}`, 'error');
      }
    } finally {
      store.loading = false;
      if (state.currentChannel?.id === channel.id) {
        dom.messageLoading.hidden = true;
      }
    }
  }

  async function loadOlderMessages() {
    const channel = state.currentChannel;
    if (!channel) return;
    const store = getMessageStore(channel.id);
    if (store.loadingOlder || store.loading || !store.loaded || !store.hasMore) {
      return;
    }

    const before = store.items[0]?.id;
    if (!before) return;

    store.loadingOlder = true;
    dom.loadOlderButton.disabled = true;
    dom.loadOlderButton.textContent = 'Loading…';
    const previousHeight = dom.messageScroll.scrollHeight;
    const previousTop = dom.messageScroll.scrollTop;

    try {
      const messages = await api(
        `/channels/${encodeURIComponent(channel.id)}/messages?limit=${MESSAGE_LIMIT}&before=${encodeURIComponent(before)}`,
      );
      const list = Array.isArray(messages) ? messages : [];
      const chronological = list.slice().reverse();
      store.items = mergeMessages(store.items, chronological);
      store.oldest = store.items[0]?.id || store.oldest;
      store.hasMore = list.length >= MESSAGE_LIMIT;

      if (state.currentChannel?.id === channel.id) {
        renderTimeline({ auto: false });
        requestAnimationFrame(() => {
          const addedHeight = dom.messageScroll.scrollHeight - previousHeight;
          dom.messageScroll.scrollTop = previousTop + addedHeight;
        });
      }
    } catch (error) {
      toast(`Could not load older messages: ${friendlyError(error)}`, 'error');
    } finally {
      store.loadingOlder = false;
      dom.loadOlderButton.disabled = false;
      dom.loadOlderButton.textContent = 'Load older messages';
      updateTimelineControls();
    }
  }

  async function refreshActiveMessages() {
    const channel = state.currentChannel;
    if (!channel) return;
    const store = getMessageStore(channel.id);
    if (store.loading || store.refreshing) return;

    store.refreshing = true;
    const wasNearBottom = isNearBottom();
    try {
      const messages = await api(
        `/channels/${encodeURIComponent(channel.id)}/messages?limit=${MESSAGE_LIMIT}`,
      );
      const list = Array.isArray(messages) ? messages : [];
      store.items = mergeMessages(store.items, list.slice().reverse());
      store.loaded = true;
      store.loadedAt = Date.now();

      if (state.currentChannel?.id === channel.id) {
        renderTimeline({ bottom: wasNearBottom });
      }
    } catch {
      // A live gateway and a failed refresh should not interrupt the user.
    } finally {
      store.refreshing = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Message rendering
  // ---------------------------------------------------------------------------

  function isNearBottom() {
    const area = dom.messageScroll;
    return area.scrollHeight - area.scrollTop - area.clientHeight < 110;
  }

  function scrollToBottom(behavior = 'auto') {
    dom.messageScroll.scrollTo({
      top: dom.messageScroll.scrollHeight,
      behavior,
    });
  }

  function updateTimelineControls() {
    const channel = state.currentChannel;
    if (!channel) {
      dom.loadOlderWrap.hidden = true;
      dom.channelEnd.hidden = true;
      dom.jumpBottomWrap.hidden = true;
      return;
    }

    const store = getMessageStore(channel.id);
    const canLoadOlder =
      store.loaded && store.hasMore && store.items.length > 0;
    dom.loadOlderWrap.hidden = !canLoadOlder;
    dom.channelEnd.hidden = !(store.loaded && !store.hasMore);
    dom.channelEndLabel.textContent =
      channel.type === 1 || channel.type === 3
        ? 'This is the beginning of your direct message history.'
        : 'This is the beginning of the conversation.';
    dom.jumpBottomWrap.hidden =
      !store.loaded || store.items.length === 0 || isNearBottom();
  }

  function renderTimeline(options = {}) {
    const channel = state.currentChannel;
    if (!channel) return;
    const store = getMessageStore(channel.id);
    const fragment = document.createDocumentFragment();
    fragment.appendChild(createChannelIntro(channel));

    let previous = null;
    let previousDay = null;

    for (const message of store.items) {
      const timestamp = new Date(message.timestamp);
      if (Number.isNaN(timestamp.getTime())) continue;

      const currentDay = dayKey(timestamp);
      if (currentDay !== previousDay) {
        const divider = el('div', 'date-divider');
        divider.appendChild(el('span', '', dateSeparatorLabel(timestamp)));
        fragment.appendChild(divider);
        previous = null;
        previousDay = currentDay;
      }

      const grouped = shouldGroupMessages(previous, message, timestamp);
      fragment.appendChild(
        createMessageRow(
          message,
          grouped,
          options.animateId === message.id,
        ),
      );
      previous = message;
    }

    dom.messageList.replaceChildren(fragment);
    updateTimelineControls();

    if (options.restoreScrollTop !== undefined && options.bottom !== true) {
      requestAnimationFrame(() => {
        dom.messageScroll.scrollTop = options.restoreScrollTop;
        updateTimelineControls();
      });
    } else if (
      options.bottom === true ||
      (options.auto !== false && isNearBottom())
    ) {
      requestAnimationFrame(() => {
        scrollToBottom();
        updateTimelineControls();
      });
    }
  }

  function shouldGroupMessages(previous, current, currentDate) {
    if (!previous || !previous.author || !current.author) return false;
    if (previous.author.id !== current.author.id) return false;
    if (current.message_reference) return false;
    const previousDate = new Date(previous.timestamp);
    if (Number.isNaN(previousDate.getTime())) return false;
    if (dayKey(previousDate) !== dayKey(currentDate)) return false;
    const difference = currentDate.getTime() - previousDate.getTime();
    return difference >= 0 && difference < 7 * 60 * 1000;
  }

  function createChannelIntro(channel) {
    const intro = el('div', 'channel-intro');
    const icon = el('div', 'channel-intro-icon');
    const isDm = channel.type === 1 || channel.type === 3;

    if (isDm) {
      icon.appendChild(createChannelAvatar(channel, 'avatar-48'));
    } else {
      icon.textContent = '#';
    }

    const title = el(
      'h2',
      '',
      isDm ? privateChannelName(channel) : `#${channel.name || 'channel'}`,
    );

    let description;
    if (isDm) {
      description =
        channel.type === 3
          ? 'This is the beginning of your group conversation.'
          : `This is the beginning of your direct message history with ${privateChannelName(channel)}.`;
    } else {
      description =
        channel.topic || `This is the start of the #${channel.name || 'channel'} channel.`;
    }

    const paragraph = el('p', '', description);
    intro.appendChild(icon);
    intro.appendChild(title);
    intro.appendChild(paragraph);
    return intro;
  }

  function lookupChannelName(channelId) {
    for (const channels of state.guildChannels.values()) {
      const channel = channels.find((candidate) => candidate.id === channelId);
      if (channel) return channel.name;
    }
    const dm = state.dms.find((candidate) => candidate.id === channelId);
    if (dm) return privateChannelName(dm);
    return null;
  }

  function createReplyReference(message) {
    const container = el('div', 'message-reply-ref');
    container.appendChild(el('span', 'reply-line'));

    const referenced = message.referenced_message;
    if (!referenced) {
      container.appendChild(
        el('span', 'reply-ref-text', 'Original message was deleted'),
      );
      return container;
    }

    const button = el('button', 'reply-ref-content');
    button.type = 'button';
    button.dataset.jumpMessage = referenced.id;
    button.appendChild(
      el('span', 'reply-ref-author', messageAuthorName(referenced)),
    );
    button.appendChild(
      el('span', 'reply-ref-text', messagePreview(referenced)),
    );
    container.appendChild(button);
    return container;
  }

  function createMessageActions(message) {
    const actions = el('div', 'message-actions');

    const reply = el('button', 'icon-button');
    reply.type = 'button';
    reply.dataset.action = 'reply';
    reply.title = 'Reply';
    reply.setAttribute('aria-label', 'Reply');
    reply.innerHTML = icons.reply;
    actions.appendChild(reply);

    if (state.me?.id === message.author?.id) {
      const remove = el('button', 'icon-button danger');
      remove.type = 'button';
      remove.dataset.action = 'delete';
      remove.title = 'Delete message';
      remove.setAttribute('aria-label', 'Delete message');
      remove.innerHTML = icons.trash;
      actions.appendChild(remove);
    }

    return actions;
  }

  function createEmbed(embed) {
    if (!embed) return null;
    const title = embed.title || '';
    const description = embed.description || '';
    if (!title && !description) return null;

    const box = el('div', 'embed');
    if (embed.provider?.name) {
      box.appendChild(el('div', 'embed-provider', embed.provider.name));
    }
    if (title) {
      const titleNode = el('div', 'embed-title', title);
      box.appendChild(titleNode);
    }
    if (description) {
      box.appendChild(el('div', 'embed-description', description));
    }
    return box;
  }

  function createAttachment(attachment) {
    const rawUrl = attachment?.url || attachment?.proxy_url;
    if (!rawUrl || !isDiscordCdn(rawUrl)) return null;

    const name = attachment.filename || 'attachment';
    const size = formatBytes(attachment.size);
    const contentType = String(attachment.content_type || '');
    const looksLikeImage =
      contentType.startsWith('image/') ||
      /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(rawUrl);

    if (looksLikeImage) {
      const image = new Image();
      image.className = 'attachment-image';
      image.alt = name;
      image.loading = 'lazy';
      image.decoding = 'async';
      image.src = rawUrl;
      image.addEventListener('error', () => {
        const fileLink = createFileAttachment(rawUrl, name, size);
        if (fileLink) image.replaceWith(fileLink);
        else image.remove();
      });
      return image;
    }

    return createFileAttachment(rawUrl, name, size);
  }

  function createFileAttachment(url, name, size) {
    const link = el('a', 'attachment-file');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const icon = el('span', 'attachment-icon');
    icon.innerHTML = icons.file;
    link.appendChild(icon);
    link.appendChild(el('span', 'attachment-name', name));
    if (size) link.appendChild(el('span', 'attachment-size', size));
    return link;
  }

  function createMessageRow(message, grouped, animate) {
    const row = el('div', `message-row${grouped ? ' grouped' : ''}`);
    row.dataset.messageId = message.id;
    if (animate) row.classList.add('message-new');

    const timestamp = new Date(message.timestamp);
    const time = formatTime(timestamp);
    const fullDate = formatFullDate(timestamp);

    const avatarColumn = el('div', 'message-avatar-column');
    if (grouped) {
      const compact = el('time', 'compact-time', time);
      compact.dateTime = timestamp.toISOString();
      compact.title = fullDate;
      avatarColumn.appendChild(compact);
    } else {
      avatarColumn.appendChild(createAvatar(message.author, 'avatar-40'));
    }

    const content = el('div', 'message-content');
    if (!grouped) {
      const header = el('div', 'message-header');
      const author = el('span', 'message-author', memberName(message));
      if (state.me?.id === message.author?.id) {
        author.classList.add('is-self');
      }
      header.appendChild(author);

      if (message.author?.bot) {
        header.appendChild(el('span', 'bot-tag', 'BOT'));
      }

      const timestampNode = el('time', 'message-timestamp', time);
      timestampNode.dateTime = timestamp.toISOString();
      timestampNode.title = fullDate;
      header.appendChild(timestampNode);

      if (message.edited_timestamp) {
        const edited = el('span', 'message-edited', '(edited)');
        edited.title = `Edited ${formatFullDate(new Date(message.edited_timestamp))}`;
        header.appendChild(edited);
      }

      content.appendChild(header);
    }

    if (message.message_reference) {
      content.appendChild(createReplyReference(message));
    }

    if (message.content) {
      const text = el('div', 'message-text');
      text.innerHTML = renderMarkdown(message.content, {
        mentions: message.mentions,
        lookupChannel: lookupChannelName,
      });
      content.appendChild(text);
    }

    if (Array.isArray(message.embeds) && message.embeds.length > 0) {
      for (const embed of message.embeds.slice(0, 3)) {
        const node = createEmbed(embed);
        if (node) content.appendChild(node);
      }
    }

    if (Array.isArray(message.attachments) && message.attachments.length > 0) {
      const attachments = el('div', 'attachments');
      for (const attachment of message.attachments) {
        const node = createAttachment(attachment);
        if (node) attachments.appendChild(node);
      }
      if (attachments.childElementCount > 0) content.appendChild(attachments);
    }

    content.appendChild(createMessageActions(message));
    row.appendChild(avatarColumn);
    row.appendChild(content);
    return row;
  }

  function updateJumpButton() {
    const channel = state.currentChannel;
    if (!channel) {
      dom.jumpBottomWrap.hidden = true;
      return;
    }
    const store = getMessageStore(channel.id);
    dom.jumpBottomWrap.hidden =
      !store.loaded || store.items.length === 0 || isNearBottom();
  }

  // ---------------------------------------------------------------------------
  // Live events
  // ---------------------------------------------------------------------------

  function updateChannelLastMessage(channelId, messageId, guildId) {
    const dm = state.dms.find((channel) => channel.id === channelId);
    if (dm) {
      dm.last_message_id = messageId;
      return;
    }

    for (const [cachedGuildId, channels] of state.guildChannels) {
      const channel = channels.find((candidate) => candidate.id === channelId);
      if (channel) {
        channel.last_message_id = messageId;
        state.channelGuildIds.set(channelId, cachedGuildId);
        return;
      }
    }

    if (guildId) state.channelGuildIds.set(channelId, guildId);
  }

  function markChannelRead(channelId) {
    if (!state.unreadChannels.has(channelId)) return;
    state.unreadChannels.delete(channelId);
    renderGuilds();
    if (
      (state.mode === 'guild' &&
        state.channelGuildIds.get(channelId) === state.selectedGuildId) ||
      state.mode === 'home'
    ) {
      renderSidebar();
    }
    updateDocumentTitle();
  }

  function markChannelUnread(channelId, guildId) {
    state.unreadChannels.add(channelId);
    if (guildId) state.channelGuildIds.set(channelId, guildId);
    updateDocumentTitle();
    renderGuilds();
    if (
      (state.mode === 'guild' &&
        state.channelGuildIds.get(channelId) === state.selectedGuildId) ||
      (state.mode === 'home' && !guildId)
    ) {
      renderSidebar();
    }
  }

  function handleMessageCreate(message) {
    if (!message?.id || !message.channel_id) return;

    const channelId = message.channel_id;
    const guildId = message.guild_id || state.channelGuildIds.get(channelId);
    updateChannelLastMessage(channelId, message.id, guildId);
    const { created } = upsertMessage(channelId, message);

    if (state.currentChannel?.id === channelId) {
      markChannelRead(channelId);
      renderTimeline({
        bottom: message.author?.id === state.me?.id,
        animateId: created ? message.id : null,
      });
      return;
    }

    if (message.author?.id !== state.me?.id) {
      markChannelUnread(channelId, guildId);
    } else if (state.mode === 'home') {
      renderSidebar();
    }
  }

  function handleMessageUpdate(message) {
    if (!message?.id || !message.channel_id) return;
    const store = state.messageStores.get(message.channel_id);
    if (!store) return;

    const existing = store.items.find((item) => item.id === message.id);
    if (!existing) return;
    upsertMessage(message.channel_id, message);

    if (state.currentChannel?.id === message.channel_id) {
      renderTimeline({ auto: false });
    }
  }

  function handleMessageDelete(data) {
    if (!data?.id || !data.channel_id) return;
    if (removeMessage(data.channel_id, data.id)) {
      if (state.currentChannel?.id === data.channel_id) {
        renderTimeline({ auto: false });
      }
    }
  }

  function handleMessageDeleteBulk(data) {
    if (!data?.channel_id || !Array.isArray(data.ids)) return;
    let removed = false;
    for (const id of data.ids) {
      removed = removeMessage(data.channel_id, id) || removed;
    }
    if (removed && state.currentChannel?.id === data.channel_id) {
      renderTimeline({ auto: false });
    }
  }

  function typingUserName(data) {
    if (data.member?.user) {
      return data.member.nick || displayName(data.member.user);
    }
    const dm = state.dms.find((channel) => channel.id === data.channel_id);
    const user = privateRecipients(dm).find(
      (recipient) => recipient.id === data.user_id,
    );
    return user ? displayName(user) : 'Someone';
  }

  function handleTypingStart(data) {
    if (!data?.channel_id || data.user_id === state.me?.id) return;
    if (state.currentChannel?.id !== data.channel_id) return;

    let typingMap = state.typingByChannel.get(data.channel_id);
    if (!typingMap) {
      typingMap = new Map();
      state.typingByChannel.set(data.channel_id, typingMap);
    }

    const previous = typingMap.get(data.user_id);
    if (previous?.timer) clearTimeout(previous.timer);

    const timer = setTimeout(() => {
      const map = state.typingByChannel.get(data.channel_id);
      if (!map) return;
      map.delete(data.user_id);
      renderTypingBar();
    }, TYPING_TIMEOUT);

    typingMap.set(data.user_id, {
      name: typingUserName(data),
      timer,
    });
    renderTypingBar();
  }

  function renderTypingBar() {
    const channel = state.currentChannel;
    if (!channel) {
      dom.typingBar.classList.add('no-typing');
      dom.typingText.textContent = '';
      return;
    }

    const typingMap = state.typingByChannel.get(channel.id);
    const names = [];
    if (typingMap) {
      for (const [userId, entry] of typingMap) {
        if (entry.name) names.push(entry.name);
        if (names.length >= 3) break;
        void userId;
      }
    }

    if (names.length === 0) {
      dom.typingBar.classList.add('no-typing');
      dom.typingText.textContent = '';
      return;
    }

    dom.typingBar.classList.remove('no-typing');
    if (names.length === 1) {
      dom.typingText.textContent = `${names[0]} is typing...`;
    } else if (names.length === 2) {
      dom.typingText.textContent = `${names[0]} and ${names[1]} are typing...`;
    } else {
      dom.typingText.textContent = 'Several people are typing...';
    }
  }

  function handleChannelCreate(channel) {
    if (!channel?.id) return;

    if (channel.type === 1 || channel.type === 3) {
      if (!state.dms.some((candidate) => candidate.id === channel.id)) {
        state.dms.push(channel);
      }
      if (state.mode === 'home') renderSidebar();
      renderGuilds();
      return;
    }

    const guildId = channel.guild_id;
    if (!guildId) return;
    state.channelGuildIds.set(channel.id, guildId);
    const channels = state.guildChannels.get(guildId);
    if (channels && !channels.some((candidate) => candidate.id === channel.id)) {
      channels.push(channel);
      if (state.mode === 'guild' && state.selectedGuildId === guildId) {
        renderSidebar();
      }
    }
  }

  function handleChannelUpdate(channel) {
    if (!channel?.id) return;

    if (channel.type === 1 || channel.type === 3) {
      const index = state.dms.findIndex((candidate) => candidate.id === channel.id);
      if (index >= 0) state.dms[index] = { ...state.dms[index], ...channel };
      if (state.mode === 'home') renderSidebar();
    } else {
      const guildId = channel.guild_id;
      if (guildId) {
        state.channelGuildIds.set(channel.id, guildId);
        const channels = state.guildChannels.get(guildId);
        if (channels) {
          const index = channels.findIndex(
            (candidate) => candidate.id === channel.id,
          );
          if (index >= 0) channels[index] = { ...channels[index], ...channel };
        }
        if (state.mode === 'guild' && state.selectedGuildId === guildId) {
          renderSidebar();
        }
      }
    }

    if (state.currentChannel?.id === channel.id) {
      state.currentChannel = { ...state.currentChannel, ...channel };
      if (channel.type === 1 || channel.type === 3) {
        fillChannelAvatar(dom.chatChannelIcon, channel, 'avatar-24');
        dom.chatTitle.textContent = privateChannelName(channel);
        dom.messageInput.placeholder = `Message ${privateChannelName(channel)}`;
      } else {
        dom.chatTitle.textContent = channel.name || 'channel';
        dom.chatTopic.textContent = channel.topic || '';
        dom.messageInput.placeholder = `Message #${channel.name || 'channel'}`;
      }
      renderTimeline({ auto: false });
    }
  }

  function handleChannelDelete(channel) {
    if (!channel?.id) return;
    const wasCurrent = state.currentChannel?.id === channel.id;
    const deletedGuildId =
      channel.guild_id || state.channelGuildIds.get(channel.id) || null;
    state.dms = state.dms.filter((candidate) => candidate.id !== channel.id);

    for (const [guildId, channels] of state.guildChannels) {
      const index = channels.findIndex((candidate) => candidate.id === channel.id);
      if (index >= 0) {
        channels.splice(index, 1);
        if (state.mode === 'guild' && state.selectedGuildId === guildId) {
          renderSidebar();
        }
      }
    }

    state.unreadChannels.delete(channel.id);
    if (!wasCurrent) {
      if (state.mode === 'home') renderSidebar();
      updateDocumentTitle();
      renderGuilds();
      return;
    }

    removeStorage(LAST_CHANNEL_KEY);
    if (deletedGuildId && state.mode === 'guild') {
      const guildId = state.selectedGuildId;
      if (guildId) {
        selectGuild(guildId, { fromRail: false }).catch(() => {});
      }
    } else {
      closeActiveChannel();
      showEmptyView(
        'Direct Messages',
        'That conversation is no longer available. Choose another one from the sidebar.',
      );
      renderSidebar();
      renderGuilds();
    }
  }

  function handleGuildCreate(guild) {
    if (!guild?.id || guild.unavailable) return;

    const existing = state.guilds.find((candidate) => candidate.id === guild.id);
    if (existing) {
      Object.assign(existing, guild);
    } else {
      state.guilds.push(guild);
    }

    if (Array.isArray(guild.channels)) {
      state.guildChannels.set(guild.id, guild.channels);
      for (const channel of guild.channels) {
        state.channelGuildIds.set(channel.id, guild.id);
      }
    }

    renderGuilds();
    if (state.mode === 'guild' && state.selectedGuildId === guild.id) {
      renderSidebar();
    }
  }

  function handleGuildUpdate(guild) {
    if (!guild?.id) return;
    const existing = state.guilds.find((candidate) => candidate.id === guild.id);
    if (existing) Object.assign(existing, guild);
    renderGuilds();
    if (state.mode === 'guild' && state.selectedGuildId === guild.id) {
      renderSidebar();
    }
  }

  function handleGuildDelete(guild) {
    if (!guild?.id) return;
    state.guilds = state.guilds.filter((candidate) => candidate.id !== guild.id);
    state.guildChannels.delete(guild.id);
    if (state.selectedGuildId === guild.id) {
      selectHome();
    } else {
      renderGuilds();
    }
  }

  // ---------------------------------------------------------------------------
  // Message actions and composer
  // ---------------------------------------------------------------------------

  function currentStoreMessage(messageId) {
    const channel = state.currentChannel;
    if (!channel) return null;
    return (
      getMessageStore(channel.id).items.find(
        (message) => message.id === messageId,
      ) || null
    );
  }

  function setReplyTo(message, options = {}) {
    if (!message) return;
    state.replyTo = message;
    dom.replyAuthor.textContent = messageAuthorName(message);
    dom.replyPreview.textContent = messagePreview(message);
    dom.replyBar.hidden = false;
    if (options.focus !== false) dom.messageInput.focus();
  }

  function cancelReply(options = {}) {
    state.replyTo = null;
    dom.replyBar.hidden = true;
    if (options.focus) dom.messageInput.focus();
  }

  async function deleteMessage(message) {
    const channel = state.currentChannel;
    if (!channel || !message) return;
    if (!window.confirm('Delete this message?')) return;

    try {
      await api(
        `/messages/${encodeURIComponent(message.id)}?channelId=${encodeURIComponent(channel.id)}`,
        { method: 'DELETE' },
      );
      removeMessage(channel.id, message.id);
      renderTimeline({ auto: false });
      toast('Message deleted.', 'success', 2500);
    } catch (error) {
      toast(`Could not delete message: ${friendlyError(error)}`, 'error');
    }
  }

  function jumpToMessage(messageId) {
    if (!messageId) return;
    const row = dom.messageList.querySelector(
      `.message-row[data-message-id="${CSS.escape(messageId)}"]`,
    );
    if (!row) {
      toast('That message is not in the loaded history.', 'info');
      return;
    }
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.remove('message-flash');
    void row.offsetWidth;
    row.classList.add('message-flash');
    setTimeout(() => row.classList.remove('message-flash'), 1300);
  }

  function handleMessageListClick(event) {
    const spoiler = event.target.closest('.spoiler');
    if (spoiler) {
      spoiler.classList.toggle('revealed');
      return;
    }

    const jump = event.target.closest('[data-jump-message]');
    if (jump) {
      jumpToMessage(jump.dataset.jumpMessage);
      return;
    }

    const action = event.target.closest('[data-action]');
    if (!action) return;
    const row = action.closest('.message-row');
    if (!row) return;
    const message = currentStoreMessage(row.dataset.messageId);
    if (!message) return;

    if (action.dataset.action === 'reply') {
      setReplyTo(message);
    } else if (action.dataset.action === 'delete') {
      deleteMessage(message);
    }
  }

  function autoGrowComposer() {
    dom.messageInput.style.height = 'auto';
    dom.messageInput.style.height = `${Math.min(dom.messageInput.scrollHeight, 220)}px`;
  }

  function updateComposerState() {
    const value = dom.messageInput.value;
    const length = value.length;
    const tooLong = length > 2000;
    const hasChannel = Boolean(state.currentChannel);
    dom.sendButton.disabled =
      !hasChannel || !value.trim() || state.sending || tooLong;

    dom.charCount.textContent = length > 0 ? `${length} / 2,000` : '';
    dom.charCount.classList.toggle('near-limit', length >= 1800 && !tooLong);
    dom.charCount.classList.toggle('over-limit', tooLong);
    autoGrowComposer();
  }

  function maybeSendTyping() {
    const channel = state.currentChannel;
    if (!channel || state.gatewayStatus !== 'online') return;
    if (dom.messageInput.value.trim().length === 0) return;
    const now = Date.now();
    if (now - state.lastTypingSent < 8000) return;
    state.lastTypingSent = now;
    api(`/channels/${encodeURIComponent(channel.id)}/typing`, {
      method: 'POST',
    }).catch(() => {
      // Typing indicators are best-effort.
    });
  }

  async function sendCurrentMessage() {
    const channel = state.currentChannel;
    if (!channel || state.sending) return;

    const content = dom.messageInput.value;
    if (!content.trim()) return;

    const reply = state.replyTo;
    state.sending = true;
    state.replyTo = null;
    dom.replyBar.hidden = true;
    dom.messageInput.value = '';
    updateComposerState();
    autoGrowComposer();

    try {
      const message = await api(
        `/channels/${encodeURIComponent(channel.id)}/messages`,
        {
          method: 'POST',
          body: {
            content,
            replyTo: reply?.id || null,
          },
        },
      );

      if (!message?.id) throw new Error('Discord did not return the sent message.');
      updateChannelLastMessage(channel.id, message.id, message.guild_id);
      upsertMessage(channel.id, message);

      if (state.currentChannel?.id === channel.id) {
        renderTimeline({ bottom: true, animateId: message.id });
        state.lastTypingSent = 0;
      }
    } catch (error) {
      if (state.currentChannel?.id === channel.id) {
        if (!dom.messageInput.value) dom.messageInput.value = content;
        if (reply && !state.replyTo) setReplyTo(reply, { focus: false });
        updateComposerState();
        toast(`Message not sent: ${friendlyError(error)}`, 'error');
      }
    } finally {
      state.sending = false;
      updateComposerState();
    }
  }

  // ---------------------------------------------------------------------------
  // Session failure helper
  // ---------------------------------------------------------------------------

  function forceLogout(message) {
    if (!state.token) return;
    performLogout({ message });
  }

  // ---------------------------------------------------------------------------
  // Event wiring and boot
  // ---------------------------------------------------------------------------

  function bindEvents() {
    dom.loginForm.addEventListener('submit', (event) => {
      event.preventDefault();
      authenticate(dom.tokenInput.value, { auto: false });
    });

    dom.toggleToken.addEventListener('click', () => {
      const revealed = dom.tokenInput.type === 'text';
      dom.tokenInput.type = revealed ? 'password' : 'text';
      dom.toggleToken.classList.toggle('revealed', !revealed);
      dom.toggleToken.setAttribute(
        'aria-label',
        revealed ? 'Show token' : 'Hide token',
      );
      dom.toggleToken.title = revealed ? 'Show token' : 'Hide token';
      dom.tokenInput.focus();
    });

    dom.logoutButton.addEventListener('click', () => {
      if (!state.token) return;
      if (
        window.confirm(
          'Log out? This will remove the saved token from this browser.',
        )
      ) {
        performLogout();
      }
    });

    dom.homeButton.addEventListener('click', selectHome);

    dom.mobileBack.addEventListener('click', () => {
      rememberActiveScroll();
      dom.appView.classList.remove('chat-open');
    });

    dom.composer.addEventListener('submit', (event) => {
      event.preventDefault();
      sendCurrentMessage();
    });

    dom.messageInput.addEventListener('input', () => {
      updateComposerState();
      maybeSendTyping();
    });

    dom.messageInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (!dom.sendButton.disabled) sendCurrentMessage();
        return;
      }
      if (event.key === 'Escape' && !dom.replyBar.hidden) {
        event.preventDefault();
        cancelReply({ focus: true });
      }
    });

    dom.cancelReply.addEventListener('click', () => {
      cancelReply({ focus: true });
    });

    dom.loadOlderButton.addEventListener('click', () => {
      loadOlderMessages();
    });

    dom.jumpBottomButton.addEventListener('click', () => {
      scrollToBottom('smooth');
      state.newMessagesBelow = false;
    });

    dom.messageScroll.addEventListener('scroll', () => {
      updateJumpButton();
    });

    dom.messageList.addEventListener('click', handleMessageListClick);

    dom.messageList.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const spoiler = event.target.closest('.spoiler');
      if (!spoiler) return;
      event.preventDefault();
      spoiler.classList.toggle('revealed');
    });

    window.addEventListener('online', () => {
      if (state.token && !state.socket && !state.explicitlyClosed) {
        if (state.reconnectTimer) {
          clearTimeout(state.reconnectTimer);
          state.reconnectTimer = null;
        }
        state.reconnectAttempt = 0;
        connectGateway();
      }
    });

    window.addEventListener('resize', () => {
      if (!isMobile()) dom.appView.classList.remove('chat-open');
    });
  }

  function boot() {
    bindEvents();
    setGatewayStatus('offline');
    setLoginLoading(false);
    updateComposerState();

    const savedToken = readStorage(TOKEN_KEY);
    if (savedToken) {
      dom.tokenInput.value = savedToken;
      authenticate(savedToken, { auto: true });
    } else {
      window.setTimeout(() => dom.tokenInput.focus(), 50);
    }
  }

  boot();
})();
