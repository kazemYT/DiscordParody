const statusNode = document.getElementById('status');
const guildsNode = document.getElementById('guilds');
const channelPanelNode = document.getElementById('channel-panel');
const messagesNode = document.getElementById('messages');
const friendListNode = document.getElementById('friend-list');
const requestsNode = document.getElementById('friend-requests');
const chatTitle = document.getElementById('chat-title');
const chatSubtitle = document.getElementById('chat-subtitle');

let token = localStorage.getItem('token') || '';
let me = localStorage.getItem('username') || '';

const state = {
  servers: [],
  users: [],
  selectedServerId: '',
  selectedChannelId: '',
  selectedDmUser: '',
  friendRequestsIn: [],
  friends: []
};

function decodeBase64(value) {
  try {
    return atob(value);
  } catch {
    return '[ошибка расшифровки]';
  }
}

function setStatus(text, ok = true) {
  statusNode.textContent = text;
  statusNode.style.color = ok ? '#57f287' : '#ed4245';
}

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(path, { ...options, headers });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function pickInitial() {
  if (state.selectedServerId || state.selectedDmUser) return;
  if (state.servers.length > 0) {
    state.selectedServerId = state.servers[0].id;
    state.selectedChannelId = state.servers[0].channels[0]?.id || '';
  }
}

function renderGuilds() {
  guildsNode.innerHTML = '';
  const dmButton = document.createElement('button');
  dmButton.className = `guild-btn ${state.selectedDmUser ? 'active' : ''}`;
  dmButton.textContent = 'DM';
  dmButton.onclick = () => {
    state.selectedServerId = '';
    state.selectedChannelId = '';
    if (!state.selectedDmUser && state.friends.length > 0) state.selectedDmUser = state.friends[0];
    renderAll();
  };
  guildsNode.appendChild(dmButton);

  for (const server of state.servers) {
    const button = document.createElement('button');
    button.className = `guild-btn ${state.selectedServerId === server.id ? 'active' : ''}`;
    button.textContent = server.name.slice(0, 2).toUpperCase();
    button.title = server.name;
    button.onclick = () => {
      state.selectedDmUser = '';
      state.selectedServerId = server.id;
      state.selectedChannelId = server.channels[0]?.id || '';
      renderAll();
    };
    guildsNode.appendChild(button);
  }
}

function renderChannelsAndFriends() {
  channelPanelNode.innerHTML = '';

  if (state.selectedServerId) {
    const server = state.servers.find((s) => s.id === state.selectedServerId);
    if (server) {
      for (const channel of server.channels) {
        const row = document.createElement('div');
        row.className = `item ${state.selectedChannelId === channel.id ? 'active' : ''}`;
        row.textContent = `# ${channel.name}`;
        row.onclick = () => {
          state.selectedChannelId = channel.id;
          renderAll();
        };
        channelPanelNode.appendChild(row);
      }
    }
  } else {
    const dmTitle = document.createElement('div');
    dmTitle.className = 'panel-title';
    dmTitle.textContent = 'Личные сообщения';
    channelPanelNode.appendChild(dmTitle);

    for (const friend of state.friends) {
      const row = document.createElement('div');
      row.className = `item ${state.selectedDmUser === friend ? 'active' : ''}`;
      row.textContent = friend;
      row.onclick = () => {
        state.selectedDmUser = friend;
        renderAll();
      };
      channelPanelNode.appendChild(row);
    }
  }

  friendListNode.innerHTML = '<div class="panel-title">Список друзей</div>';
  for (const friend of state.friends) {
    const row = document.createElement('div');
    row.className = 'item';
    row.textContent = friend;
    row.onclick = () => {
      state.selectedServerId = '';
      state.selectedChannelId = '';
      state.selectedDmUser = friend;
      renderAll();
    };
    friendListNode.appendChild(row);
  }

  requestsNode.innerHTML = '<div class="panel-title">Входящие заявки</div>';
  for (const requester of state.friendRequestsIn) {
    const row = document.createElement('div');
    row.className = 'item req-row';
    row.innerHTML = `<span>${requester}</span><button data-u="${requester}">Принять</button>`;
    row.querySelector('button').onclick = async () => {
      try {
        await api('/api/friends/accept', {
          method: 'POST',
          body: JSON.stringify({ username: requester })
        });
        await refreshBootstrap();
      } catch (error) {
        setStatus(error.message, false);
      }
    };
    requestsNode.appendChild(row);
  }
}

function renderMessagesForServer() {
  messagesNode.innerHTML = '';
  const server = state.servers.find((s) => s.id === state.selectedServerId);
  const channel = server?.channels.find((c) => c.id === state.selectedChannelId);
  if (!server || !channel) {
    chatTitle.textContent = 'Сервер не выбран';
    chatSubtitle.textContent = 'Выбери сервер и канал';
    return;
  }

  chatTitle.textContent = `${server.name} · #${channel.name}`;
  chatSubtitle.textContent = 'Сообщения в канале';

  for (const msg of channel.messages) {
    const row = document.createElement('div');
    row.className = 'message';
    row.innerHTML = `<strong>${msg.author}</strong>: ${decodeBase64(msg.encryptedText)}<div class="meta">Base64: ${msg.encryptedText}</div>`;
    messagesNode.appendChild(row);
  }
}

async function renderMessagesForDm() {
  messagesNode.innerHTML = '';
  if (!state.selectedDmUser) {
    chatTitle.textContent = 'ЛС';
    chatSubtitle.textContent = 'Выбери друга';
    return;
  }

  chatTitle.textContent = `ЛС · ${state.selectedDmUser}`;
  chatSubtitle.textContent = 'Личные сообщения (доступны только друзьям)';

  try {
    const result = await api(`/api/dm/messages?with=${encodeURIComponent(state.selectedDmUser)}`);
    for (const msg of result.messages) {
      const row = document.createElement('div');
      row.className = 'message';
      row.innerHTML = `<strong>${msg.author}</strong>: ${decodeBase64(msg.encryptedText)}<div class="meta">Base64: ${msg.encryptedText}</div>`;
      messagesNode.appendChild(row);
    }
  } catch (error) {
    setStatus(error.message, false);
  }
}

async function renderAll() {
  renderGuilds();
  renderChannelsAndFriends();

  if (state.selectedServerId) {
    renderMessagesForServer();
  } else {
    await renderMessagesForDm();
  }
}

async function refreshBootstrap() {
  if (!token) return;
  const data = await api('/api/bootstrap');
  state.servers = data.servers;
  state.users = data.users;
  state.friendRequestsIn = data.me.friendRequestsIn;
  state.friends = data.me.friends;

  if (state.selectedServerId) {
    const aliveServer = state.servers.find((s) => s.id === state.selectedServerId);
    if (!aliveServer) {
      state.selectedServerId = '';
      state.selectedChannelId = '';
    } else {
      const aliveChannel = aliveServer.channels.find((c) => c.id === state.selectedChannelId);
      if (!aliveChannel) state.selectedChannelId = aliveServer.channels[0]?.id || '';
    }
  }

  if (state.selectedDmUser && !state.friends.includes(state.selectedDmUser)) {
    state.selectedDmUser = '';
  }

  pickInitial();
  await renderAll();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, {
    ...options,
    headers
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function renderServers() {
  serverList.innerHTML = '';
  for (const server of serverState) {
    const li = document.createElement('li');
    li.className = 'server-item';
    if (server.id === selectedServerId) {
      li.classList.add('active');
    }
    li.textContent = `${server.name} (owner: ${server.owner})`;
    li.onclick = () => {
      selectedServerId = server.id;
      renderServers();
      renderMessages();
    };
    serverList.appendChild(li);
  }
}

function renderMessages() {
  messagesList.innerHTML = '';
  const server = serverState.find((entry) => entry.id === selectedServerId);
  if (!server) {
    chatMeta.textContent = 'Выбери сервер для чата.';
    return;
  }
  chatMeta.textContent = `Сервер: ${server.name}`;

  for (const msg of server.messages) {
    const li = document.createElement('li');
    const decrypted = toBase64Decoded(msg.encryptedText);
    li.innerHTML = `<strong>${msg.author}</strong>: ${decrypted}<div class="small">Base64: ${msg.encryptedText}</div>`;
    messagesList.appendChild(li);
  }
}

async function refreshServers() {
  if (!token) return;
  const result = await api('/api/servers');
  serverState = result.servers;
  if (!selectedServerId && serverState.length > 0) {
    selectedServerId = serverState[0].id;
  }
  renderServers();
  renderMessages();
}

async function handleAuth(mode) {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const result = await api(`/api/${mode}`, {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    token = result.token;
    me = result.username;
    localStorage.setItem('token', token);
    localStorage.setItem('username', me);
    setStatus(`Вошли как ${me}`);
    await refreshBootstrap();
  } catch (error) {
    setStatus(error.message, false);
  }
}

document.getElementById('register-btn').onclick = () => handleAuth('register');
document.getElementById('login-btn').onclick = () => handleAuth('login');

document.getElementById('create-server-btn').onclick = async () => {
  const name = document.getElementById('server-name').value.trim();
  try {
    await api('/api/servers', { method: 'POST', body: JSON.stringify({ name }) });
    document.getElementById('server-name').value = '';
    await refreshBootstrap();
  } catch (error) {
    setStatus(error.message, false);
  }
};

document.getElementById('create-channel-btn').onclick = async () => {
  const name = document.getElementById('channel-name').value.trim();
  if (!state.selectedServerId) return setStatus('Выбери сервер для создания канала.', false);

  try {
    await api(`/api/servers/${state.selectedServerId}/channels`, {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    document.getElementById('channel-name').value = '';
    await refreshBootstrap();
  } catch (error) {
    setStatus(error.message, false);
  }
};

document.getElementById('add-friend-btn').onclick = async () => {
  const username = document.getElementById('friend-name').value.trim();
  try {
    await api('/api/friends/request', {
      method: 'POST',
      body: JSON.stringify({ username })
    });
    document.getElementById('friend-name').value = '';
    setStatus('Заявка отправлена');
    await refreshBootstrap();
  } catch (error) {
    setStatus(error.message, false);
  }
};

document.getElementById('send-message-btn').onclick = async () => {
  const text = document.getElementById('message-text').value;
  try {
    if (state.selectedServerId) {
      await api(`/api/servers/${state.selectedServerId}/channels/${state.selectedChannelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text })
      });
    } else {
      if (!state.selectedDmUser) return setStatus('Выбери получателя ЛС.', false);
      await api('/api/dm/messages', {
        method: 'POST',
        body: JSON.stringify({ to: state.selectedDmUser, text })
      });
    }
    document.getElementById('message-text').value = '';
    await refreshBootstrap();
  } catch (error) {
    setStatus(error.message, false);
  }
};

if (token && me) {
  setStatus(`Вошли как ${me}`);
  refreshBootstrap().catch(() => setStatus('Ошибка загрузки. Войдите снова.', false));
} else {
  setStatus('Не авторизован', false);
}
