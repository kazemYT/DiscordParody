const statusNode = document.getElementById('status');
const guildsNode = document.getElementById('guilds');
const channelPanelNode = document.getElementById('channel-panel');
const messagesNode = document.getElementById('messages');
const friendListNode = document.getElementById('friend-list');
const requestsNode = document.getElementById('friend-requests');
const chatTitle = document.getElementById('chat-title');
const chatSubtitle = document.getElementById('chat-subtitle');
const dmPane = document.getElementById('dm-pane');
const friendsPane = document.getElementById('friends-pane');

let token = localStorage.getItem('token') || '';
let me = localStorage.getItem('username') || '';

const state = {
  servers: [],
  users: [],
  selectedServerId: '',
  selectedChannelId: '',
  selectedDmUser: '',
  friendRequestsIn: [],
  friends: [],
  meAvatar: '',
  friendsTab: 'dm'
};

function decodeBase64(value) {
  try {
    return atob(value);
  } catch {
    return '[ошибка расшифровки]';
  }
}

function avatarOf(username) {
  return state.users.find((u) => u.username === username)?.avatar || `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(username)}`;
}

function readImageData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    reader.readAsDataURL(file);
  });
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

function getSelectedServer() {
  return state.servers.find((s) => s.id === state.selectedServerId);
}

function getSelectedChannel(server) {
  for (const category of server.categories) {
    const channel = category.channels.find((ch) => ch.id === state.selectedChannelId);
    if (channel) return channel;
  }
  return null;
}

function pickInitial() {
  if (state.selectedServerId || state.selectedDmUser) return;
  if (state.servers.length > 0) {
    state.selectedServerId = state.servers[0].id;
    state.selectedChannelId = state.servers[0].categories[0]?.channels[0]?.id || '';
  }
}

function renderGuilds() {
  guildsNode.innerHTML = '';

  const homeButton = document.createElement('button');
  homeButton.className = `guild-btn ${!state.selectedServerId ? 'active' : ''}`;
  homeButton.textContent = '👤';
  homeButton.title = 'Личные сообщения';
  homeButton.onclick = () => {
    state.selectedServerId = '';
    state.selectedChannelId = '';
    if (!state.selectedDmUser && state.friends.length > 0) state.selectedDmUser = state.friends[0];
    renderAll();
  };
  guildsNode.appendChild(homeButton);

  const spacer = document.createElement('div');
  spacer.className = 'guild-spacer';
  guildsNode.appendChild(spacer);

  for (const server of state.servers) {
    const button = document.createElement('button');
    button.className = `guild-btn ${state.selectedServerId === server.id ? 'active' : ''}`;
    button.textContent = server.name.slice(0, 2).toUpperCase();
    button.title = server.name;
    button.onclick = () => {
      state.selectedDmUser = '';
      state.selectedServerId = server.id;
      state.selectedChannelId = server.categories[0]?.channels[0]?.id || '';
      renderAll();
    };
    guildsNode.appendChild(button);
  }

  const addServerBtn = document.createElement('button');
  addServerBtn.className = 'guild-btn add';
  addServerBtn.textContent = '+';
  addServerBtn.title = 'Создать сервер';
  addServerBtn.onclick = async () => {
    const name = window.prompt('Название нового сервера');
    if (!name || !name.trim()) return;
    try {
      await api('/api/servers', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
      await refreshBootstrap();
    } catch (error) {
      setStatus(error.message, false);
    }
  };
  guildsNode.appendChild(addServerBtn);

  const profile = document.createElement('div');
  profile.className = 'guild-profile';
  const avatar = document.createElement('img');
  avatar.className = 'avatar';
  avatar.src = state.meAvatar || avatarOf(me || 'guest');
  avatar.alt = me || 'guest';
  const nick = document.createElement('div');
  nick.className = 'nick';
  nick.textContent = me || 'guest';
  profile.appendChild(avatar);
  profile.appendChild(nick);
  guildsNode.appendChild(profile);
}

function renderLeftPane() {
  const isServer = Boolean(state.selectedServerId);
  dmPane.classList.toggle('hidden', isServer || state.friendsTab !== 'dm');
  friendsPane.classList.toggle('hidden', isServer || state.friendsTab !== 'friends');

  if (isServer) {
    channelPanelNode.innerHTML = '';
    const server = getSelectedServer();
    if (!server) return;

    for (const category of server.categories) {
      const wrap = document.createElement('div');
      wrap.className = 'category';

      const head = document.createElement('div');
      head.className = 'category-head';
      head.innerHTML = `<div class="panel-title">${category.name}</div>`;

      const addChannelBtn = document.createElement('button');
      addChannelBtn.className = 'category-btn';
      addChannelBtn.textContent = '+';
      addChannelBtn.title = 'Создать канал';
      addChannelBtn.onclick = async () => {
        const name = window.prompt('Название канала');
        if (!name || !name.trim()) return;
        try {
          await api(`/api/servers/${server.id}/channels`, {
            method: 'POST',
            body: JSON.stringify({ name: name.trim(), categoryId: category.id })
          });
          await refreshBootstrap();
        } catch (error) {
          setStatus(error.message, false);
        }
      };
      head.appendChild(addChannelBtn);
      wrap.appendChild(head);

      for (const channel of category.channels) {
        const row = document.createElement('div');
        row.className = `item ${state.selectedChannelId === channel.id ? 'active' : ''}`;
        row.textContent = `# ${channel.name}`;
        row.onclick = () => {
          state.selectedChannelId = channel.id;
          renderAll();
        };
        wrap.appendChild(row);
      }

      channelPanelNode.appendChild(wrap);
    }
    return;
  }

  channelPanelNode.innerHTML = '';
  for (const friend of state.friends) {
    const row = document.createElement('div');
    row.className = `item row-user ${state.selectedDmUser === friend ? 'active' : ''}`;
    row.innerHTML = `<img class="avatar" src="${avatarOf(friend)}" alt="${friend}" /><span>${friend}</span>`;
    row.onclick = () => {
      state.selectedDmUser = friend;
      renderAll();
    };
    channelPanelNode.appendChild(row);
  }

  friendListNode.innerHTML = '<div class="panel-title">Список друзей</div>';
  for (const friend of state.friends) {
    const row = document.createElement('div');
    row.className = 'item row-user';
    row.innerHTML = `<img class="avatar" src="${avatarOf(friend)}" alt="${friend}" /><span>${friend}</span>`;
    row.onclick = () => {
      state.selectedServerId = '';
      state.selectedChannelId = '';
      state.selectedDmUser = friend;
      state.friendsTab = 'dm';
      renderAll();
    };
    friendListNode.appendChild(row);
  }

  requestsNode.innerHTML = '<div class="panel-title">Входящие заявки</div>';
  for (const requester of state.friendRequestsIn) {
    const row = document.createElement('div');
    row.className = 'item req-row';
    row.innerHTML = `<span>${requester}</span><button>Принять</button>`;
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
  const server = getSelectedServer();
  if (!server) return;
  const channel = getSelectedChannel(server);

  if (!channel) {
    chatTitle.textContent = 'Канал не выбран';
    chatSubtitle.textContent = 'Выбери канал';
    return;
  }

  chatTitle.textContent = `${server.name} · #${channel.name}`;
  chatSubtitle.textContent = 'Сообщения в канале';

  for (const msg of channel.messages) {
    const row = document.createElement('div');
    row.className = 'message';
    row.innerHTML = `
      <img class="avatar lg" src="${avatarOf(msg.author)}" alt="${msg.author}" />
      <div>
        <strong>${msg.author}</strong>: ${msg.encryptedText ? decodeBase64(msg.encryptedText) : ''}
        <div class="meta">${msg.encryptedText ? `Base64: ${msg.encryptedText}` : 'Изображение'}</div>
        ${msg.imageData ? `<img class="msg-image" src="${msg.imageData}" alt="image" />` : ''}
      </div>
    `;
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
      row.innerHTML = `
        <img class="avatar lg" src="${avatarOf(msg.author)}" alt="${msg.author}" />
        <div>
          <strong>${msg.author}</strong>: ${msg.encryptedText ? decodeBase64(msg.encryptedText) : ''}
          <div class="meta">${msg.encryptedText ? `Base64: ${msg.encryptedText}` : 'Изображение'}</div>
          ${msg.imageData ? `<img class="msg-image" src="${msg.imageData}" alt="image" />` : ''}
        </div>
      `;
      messagesNode.appendChild(row);
    }
  } catch (error) {
    setStatus(error.message, false);
  }
}

async function renderAll() {
  renderGuilds();
  renderLeftPane();

  if (state.selectedServerId) {
    renderMessagesForServer();
  } else {
    await renderMessagesForDm();
  }
}

async function refreshBootstrap() {
  const data = await api('/api/bootstrap');
  state.servers = data.servers;
  state.users = data.users;
  state.friendRequestsIn = data.me.friendRequestsIn;
  state.friends = data.me.friends;
  state.meAvatar = data.me.avatar;
  me = data.me.username;
  localStorage.setItem('username', me);

  if (state.selectedServerId) {
    const aliveServer = state.servers.find((s) => s.id === state.selectedServerId);
    if (!aliveServer) {
      state.selectedServerId = '';
      state.selectedChannelId = '';
    } else {
      let aliveChannel = false;
      for (const category of aliveServer.categories) {
        if (category.channels.some((c) => c.id === state.selectedChannelId)) {
          aliveChannel = true;
        }
      }
      if (!aliveChannel) state.selectedChannelId = aliveServer.categories[0]?.channels[0]?.id || '';
    }
  }

  if (state.selectedDmUser && !state.friends.includes(state.selectedDmUser)) {
    state.selectedDmUser = '';
  }

  pickInitial();
  await renderAll();
}

document.getElementById('dm-tab-btn').onclick = () => {
  state.friendsTab = 'dm';
  document.getElementById('dm-tab-btn').classList.add('active');
  document.getElementById('friends-tab-btn').classList.remove('active');
  renderAll();
};

document.getElementById('friends-tab-btn').onclick = () => {
  state.friendsTab = 'friends';
  document.getElementById('friends-tab-btn').classList.add('active');
  document.getElementById('dm-tab-btn').classList.remove('active');
  state.selectedServerId = '';
  renderAll();
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
  const textNode = document.getElementById('message-text');
  const imageNode = document.getElementById('message-image');
  const text = textNode.value;
  let imageData = '';

  try {
    if (imageNode.files[0]) {
      imageData = await readImageData(imageNode.files[0]);
    }

    if (state.selectedServerId) {
      await api(`/api/servers/${state.selectedServerId}/channels/${state.selectedChannelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text, imageData })
      });
    } else {
      if (!state.selectedDmUser) return setStatus('Выбери получателя ЛС.', false);
      await api('/api/dm/messages', {
        method: 'POST',
        body: JSON.stringify({ to: state.selectedDmUser, text, imageData })
      });
    }
    textNode.value = '';
    imageNode.value = '';
    await refreshBootstrap();
  } catch (error) {
    setStatus(error.message, false);
  }
};

if (!token) {
  setStatus('Проверка сессии...', true);
}

refreshBootstrap()
  .then(() => {
    setStatus(me ? `Вошли как ${me}` : 'Сессия активна');
  })
  .catch(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    window.location.href = '/auth';
  });
