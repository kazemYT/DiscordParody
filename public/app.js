const authStatus = document.getElementById('auth-status');
const serverList = document.getElementById('server-list');
const messagesList = document.getElementById('messages');
const chatMeta = document.getElementById('chat-meta');

let token = localStorage.getItem('token') || '';
let currentUser = localStorage.getItem('username') || '';
let selectedServerId = '';
let serverState = [];

function toBase64Decoded(value) {
  try {
    return atob(value);
  } catch {
    return '[Ошибка расшифровки]';
  }
}

function setAuthStatus(text, ok = true) {
  authStatus.textContent = text;
  authStatus.style.color = ok ? '#57f287' : '#ed4245';
}

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
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
    currentUser = result.username;
    localStorage.setItem('token', token);
    localStorage.setItem('username', currentUser);
    setAuthStatus(`Вошли как ${currentUser}`);
    await refreshServers();
  } catch (error) {
    setAuthStatus(error.message, false);
  }
}

document.getElementById('register-btn').onclick = () => handleAuth('register');
document.getElementById('login-btn').onclick = () => handleAuth('login');

document.getElementById('create-server-btn').onclick = async () => {
  const name = document.getElementById('server-name').value.trim();
  try {
    await api('/api/servers', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    document.getElementById('server-name').value = '';
    await refreshServers();
  } catch (error) {
    setAuthStatus(error.message, false);
  }
};

document.getElementById('send-message-btn').onclick = async () => {
  const text = document.getElementById('message-text').value;
  if (!selectedServerId) {
    setAuthStatus('Сначала выбери сервер.', false);
    return;
  }
  try {
    await api(`/api/servers/${selectedServerId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text })
    });
    document.getElementById('message-text').value = '';
    await refreshServers();
  } catch (error) {
    setAuthStatus(error.message, false);
  }
};

if (token && currentUser) {
  setAuthStatus(`Вошли как ${currentUser}`);
  refreshServers().catch(() => setAuthStatus('Сессия истекла, войдите снова.', false));
} else {
  setAuthStatus('Не авторизован', false);
}
