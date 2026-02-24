const statusNode = document.getElementById('status');
let token = localStorage.getItem('token') || '';
let me = localStorage.getItem('username') || '';

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
    window.location.href = '/';
  } catch (error) {
    setStatus(error.message, false);
  }
}

document.getElementById('register-btn').onclick = () => handleAuth('register');
document.getElementById('login-btn').onclick = () => handleAuth('login');

if (token && me) {
  window.location.href = '/';
} else {
  setStatus('Не авторизован', false);
}
