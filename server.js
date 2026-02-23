const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;

const state = {
  users: [],
  sessions: new Map(),
  servers: []
};

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        req.socket.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function createSession(username) {
  const token = crypto.randomBytes(24).toString('hex');
  state.sessions.set(token, username);
  return token;
}

function getSession(req) {
  const token = req.headers.authorization?.replace('Bearer ', '').trim();
  if (!token) return null;
  const username = state.sessions.get(token);
  if (!username) return null;
  return { token, username };
}

function readStaticFile(filePath, res) {
  const ext = path.extname(filePath);
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8'
  };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      readStaticFile(path.join(__dirname, 'public', 'index.html'), res);
      return;
    }

    if (req.method === 'GET' && req.url === '/styles.css') {
      readStaticFile(path.join(__dirname, 'public', 'styles.css'), res);
      return;
    }

    if (req.method === 'GET' && req.url === '/app.js') {
      readStaticFile(path.join(__dirname, 'public', 'app.js'), res);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/register') {
      const { username, password } = await parseBody(req);
      if (!username || !password || password.length < 4) {
        sendJson(res, 400, { error: 'Username and password (min 4 chars) are required.' });
        return;
      }
      if (state.users.find((u) => u.username === username)) {
        sendJson(res, 409, { error: 'User already exists.' });
        return;
      }
      state.users.push({ username, passwordHash: hashPassword(password) });
      const token = createSession(username);
      sendJson(res, 201, { token, username });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/login') {
      const { username, password } = await parseBody(req);
      const user = state.users.find((u) => u.username === username);
      if (!user || user.passwordHash !== hashPassword(password || '')) {
        sendJson(res, 401, { error: 'Invalid credentials.' });
        return;
      }
      const token = createSession(username);
      sendJson(res, 200, { token, username });
      return;
    }

    if (req.method === 'GET' && req.url === '/api/servers') {
      const session = getSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Please register or log in first.' });
        return;
      }

      const servers = state.servers.map((entry) => ({
        id: entry.id,
        name: entry.name,
        owner: entry.owner,
        messages: entry.messages.map((msg) => ({
          id: msg.id,
          author: msg.author,
          encryptedText: msg.encryptedText,
          createdAt: msg.createdAt
        }))
      }));

      sendJson(res, 200, { servers });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/servers') {
      const session = getSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Please register or log in first.' });
        return;
      }

      const { name } = await parseBody(req);
      if (!name || !name.trim()) {
        sendJson(res, 400, { error: 'Server name is required.' });
        return;
      }

      const newServer = {
        id: crypto.randomUUID(),
        name: name.trim(),
        owner: session.username,
        messages: []
      };

      state.servers.push(newServer);
      sendJson(res, 201, { server: newServer });
      return;
    }

    if (req.method === 'POST' && req.url.startsWith('/api/servers/') && req.url.endsWith('/messages')) {
      const session = getSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Please register or log in first.' });
        return;
      }

      const parts = req.url.split('/');
      const serverId = parts[3];
      const target = state.servers.find((entry) => entry.id === serverId);
      if (!target) {
        sendJson(res, 404, { error: 'Server not found.' });
        return;
      }

      const { text } = await parseBody(req);
      if (!text || !text.trim()) {
        sendJson(res, 400, { error: 'Message text is required.' });
        return;
      }

      const encryptedText = Buffer.from(text, 'utf-8').toString('base64');
      const newMessage = {
        id: crypto.randomUUID(),
        author: session.username,
        encryptedText,
        createdAt: new Date().toISOString()
      };

      target.messages.push(newMessage);
      sendJson(res, 201, { message: newMessage });
      return;
    }

    sendJson(res, 404, { error: 'Route not found.' });
  } catch (error) {
    sendJson(res, 400, { error: error.message || 'Unexpected error' });
  }
});

server.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
