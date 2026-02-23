const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'db.json');

function createDefaultDb() {
  return {
    users: [],
    sessions: {},
    servers: []
  };
}

function loadDb() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const seed = createDefaultDb();
      fs.writeFileSync(DB_PATH, JSON.stringify(seed, null, 2));
      return seed;
    }
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    if (!data.users || !data.sessions || !data.servers) {
      return createDefaultDb();
    }
    return data;
  } catch {
    return createDefaultDb();
  }
}

let db = loadDb();

function saveDb() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

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
  db.sessions[token] = username;
  saveDb();
  return token;
}

function parseBearerToken(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }

  const [scheme, token] = authHeader.trim().split(/\s+/);
  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token;
}

function getSession(req) {
  const token = parseBearerToken(req.headers.authorization);
  if (!token) return null;
  const sessionUsername = db.sessions[token];
  if (!sessionUsername) return null;
  return { token, username: sessionUsername };
}

function getUserByName(username) {
  return db.users.find((u) => u.username === username);
}

function getPublicUser(username) {
  const user = getUserByName(username);
  if (!user) return null;
  return {
    username: user.username,
    friends: user.friends,
    friendRequestsIn: user.friendRequestsIn,
    friendRequestsOut: user.friendRequestsOut
  };
}

function getDmBetween(userA, userB) {
  const sorted = [userA, userB].sort();
  return sorted.join('::');
}

function sanitizeServer(server) {
  return {
    id: server.id,
    name: server.name,
    owner: server.owner,
    channels: server.channels.map((ch) => ({
      id: ch.id,
      name: ch.name,
      messages: ch.messages
    }))
  };
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
      if (getUserByName(username)) {
        sendJson(res, 409, { error: 'User already exists.' });
        return;
      }

      db.users.push({
        username,
        passwordHash: hashPassword(password),
        friends: [],
        friendRequestsIn: [],
        friendRequestsOut: [],
        dms: {}
      });
      const token = createSession(username);
      saveDb();
      sendJson(res, 201, { token, username });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/login') {
      const { username, password } = await parseBody(req);
      const user = getUserByName(username);
      if (!user || user.passwordHash !== hashPassword(password || '')) {
        sendJson(res, 401, { error: 'Invalid credentials.' });
        return;
      }
      const token = createSession(username);
      sendJson(res, 200, { token, username });
      return;
    }

    if (req.method === 'GET' && req.url === '/api/bootstrap') {
      const session = getSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Please register or log in first.' });
        return;
      }
      const me = getUserByName(session.username);
      sendJson(res, 200, {
        me: getPublicUser(session.username),
        servers: db.servers.map(sanitizeServer),
        users: db.users.map((u) => ({ username: u.username }))
      });
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
      const defaultChannel = {
        id: crypto.randomUUID(),
        name: 'general',
        messages: []
      };
      const newServer = {
        id: crypto.randomUUID(),
        name: name.trim(),
        owner: session.username,
        channels: [defaultChannel]
      };
      db.servers.push(newServer);
      saveDb();
      sendJson(res, 201, { server: sanitizeServer(newServer) });
      return;
    }

    if (req.method === 'POST' && req.url.match(/^\/api\/servers\/[^/]+\/channels$/)) {
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'Please register or log in first.' });
      const serverId = req.url.split('/')[3];
      const target = db.servers.find((s) => s.id === serverId);
      if (!target) return sendJson(res, 404, { error: 'Server not found.' });
      const { name } = await parseBody(req);
      if (!name || !name.trim()) return sendJson(res, 400, { error: 'Channel name is required.' });
      const exists = target.channels.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
      if (exists) return sendJson(res, 409, { error: 'Channel already exists.' });

      const channel = { id: crypto.randomUUID(), name: name.trim(), messages: [] };
      target.channels.push(channel);
      saveDb();
      sendJson(res, 201, { channel });
      return;
    }

    if (req.method === 'POST' && req.url.match(/^\/api\/servers\/[^/]+\/channels\/[^/]+\/messages$/)) {
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'Please register or log in first.' });

      const parts = req.url.split('/');
      const serverId = parts[3];
      const channelId = parts[5];
      const target = db.servers.find((s) => s.id === serverId);
      if (!target) return sendJson(res, 404, { error: 'Server not found.' });
      const channel = target.channels.find((c) => c.id === channelId);
      if (!channel) return sendJson(res, 404, { error: 'Channel not found.' });

      const { text } = await parseBody(req);
      if (!text || !text.trim()) return sendJson(res, 400, { error: 'Message text is required.' });

      const encryptedText = Buffer.from(text, 'utf-8').toString('base64');
      const message = {
        id: crypto.randomUUID(),
        author: session.username,
        encryptedText,
        createdAt: new Date().toISOString()
      };
      channel.messages.push(message);
      saveDb();
      sendJson(res, 201, { message });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/friends/request') {
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'Please register or log in first.' });
      const { username } = await parseBody(req);
      const me = getUserByName(session.username);
      const target = getUserByName(username);
      if (!target) return sendJson(res, 404, { error: 'User not found.' });
      if (target.username === me.username) return sendJson(res, 400, { error: 'Cannot add yourself.' });
      if (me.friends.includes(target.username)) return sendJson(res, 409, { error: 'Already friends.' });
      if (me.friendRequestsOut.includes(target.username)) return sendJson(res, 409, { error: 'Request already sent.' });

      me.friendRequestsOut.push(target.username);
      target.friendRequestsIn.push(me.username);
      saveDb();
      sendJson(res, 201, { ok: true });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/friends/accept') {
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'Please register or log in first.' });
      const { username } = await parseBody(req);
      const me = getUserByName(session.username);
      const target = getUserByName(username);
      if (!target) return sendJson(res, 404, { error: 'User not found.' });
      if (!me.friendRequestsIn.includes(target.username)) return sendJson(res, 400, { error: 'No incoming request from this user.' });

      me.friendRequestsIn = me.friendRequestsIn.filter((u) => u !== target.username);
      target.friendRequestsOut = target.friendRequestsOut.filter((u) => u !== me.username);
      if (!me.friends.includes(target.username)) me.friends.push(target.username);
      if (!target.friends.includes(me.username)) target.friends.push(me.username);
      saveDb();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/dm/messages') {
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'Please register or log in first.' });

      const { to, text } = await parseBody(req);
      const fromUser = getUserByName(session.username);
      const toUser = getUserByName(to);
      if (!toUser) return sendJson(res, 404, { error: 'User not found.' });
      if (!fromUser.friends.includes(toUser.username)) return sendJson(res, 403, { error: 'DM is allowed only with friends.' });
      if (!text || !text.trim()) return sendJson(res, 400, { error: 'Message text is required.' });

      const roomId = getDmBetween(fromUser.username, toUser.username);
      const encryptedText = Buffer.from(text, 'utf-8').toString('base64');
      const message = {
        id: crypto.randomUUID(),
        author: fromUser.username,
        encryptedText,
        createdAt: new Date().toISOString()
      };

      if (!fromUser.dms[roomId]) fromUser.dms[roomId] = [];
      if (!toUser.dms[roomId]) toUser.dms[roomId] = [];

      fromUser.dms[roomId].push(message);
      toUser.dms[roomId].push(message);
      saveDb();
      sendJson(res, 201, { message });
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/dm/messages?')) {
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'Please register or log in first.' });

      const url = new URL(req.url, `http://${req.headers.host}`);
      const withUser = url.searchParams.get('with');
      const me = getUserByName(session.username);
      const other = getUserByName(withUser);
      if (!other) return sendJson(res, 404, { error: 'User not found.' });
      if (!me.friends.includes(other.username)) return sendJson(res, 403, { error: 'DM is allowed only with friends.' });

      const roomId = getDmBetween(me.username, other.username);
      sendJson(res, 200, { messages: me.dms[roomId] || [] });
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
