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

function makeAvatar(username) {
  return `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(username)}`;
}

function normalizeServer(server) {
  if (!server.categories && Array.isArray(server.channels)) {
    server.categories = [
      {
        id: crypto.randomUUID(),
        name: 'ТЕКСТОВЫЕ КАНАЛЫ',
        channels: server.channels
      }
    ];
    delete server.channels;
  }

  if (!Array.isArray(server.categories) || server.categories.length === 0) {
    server.categories = [
      {
        id: crypto.randomUUID(),
        name: 'ТЕКСТОВЫЕ КАНАЛЫ',
        channels: [
          {
            id: crypto.randomUUID(),
            name: 'general',
            messages: []
          }
        ]
      }
    ];
  }

  for (const category of server.categories) {
    if (!Array.isArray(category.channels)) {
      category.channels = [];
    }
    for (const channel of category.channels) {
      if (!Array.isArray(channel.messages)) {
        channel.messages = [];
      }
    }
  }

  return server;
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

    for (const user of data.users) {
      user.friends ||= [];
      user.friendRequestsIn ||= [];
      user.friendRequestsOut ||= [];
      user.dms ||= {};
      user.avatar ||= makeAvatar(user.username);
    }

    data.servers = data.servers.map(normalizeServer);
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
  if (!authHeader || typeof authHeader !== 'string') return null;
  const authParts = authHeader.trim().split(/\s+/);
  if (authParts.length < 2) return null;
  if (authParts[0] !== 'Bearer') return null;
  const token = authParts[1];
  if (!token) return null;
  return token;
}


function parseCookies(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== 'string') return {};
  const pairs = cookieHeader.split(';');
  const result = {};
  for (const pair of pairs) {
    const [rawKey, ...rawValue] = pair.trim().split('=');
    if (!rawKey) continue;
    result[rawKey] = decodeURIComponent(rawValue.join('='));
  }
  return result;
}

function setAuthCookie(res, token) {
  const oneWeek = 7 * 24 * 60 * 60;
  res.setHeader('Set-Cookie', `token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${oneWeek}`);
}

function isValidImageData(imageData) {
  if (!imageData) return false;
  if (typeof imageData !== 'string') return false;
  if (imageData.length > 2_000_000) return false;
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/.test(imageData);
}

function getSession(req) {
  const bearerToken = parseBearerToken(req.headers.authorization);
  const cookieToken = parseCookies(req.headers.cookie).token;
  const token = bearerToken || cookieToken;
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
    avatar: user.avatar,
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
    categories: server.categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      channels: cat.channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        messages: channel.messages
      }))
    }))
  };
}

function findChannel(server, channelId) {
  for (const category of server.categories) {
    const found = category.channels.find((channel) => channel.id === channelId);
    if (found) {
      return { channel: found, category };
    }
  }
  return null;
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

    if (req.method === 'GET' && (req.url === '/auth' || req.url === '/auth.html')) {
      readStaticFile(path.join(__dirname, 'public', 'auth.html'), res);
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

    if (req.method === 'GET' && req.url === '/auth.js') {
      readStaticFile(path.join(__dirname, 'public', 'auth.js'), res);
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
        avatar: makeAvatar(username),
        passwordHash: hashPassword(password),
        friends: [],
        friendRequestsIn: [],
        friendRequestsOut: [],
        dms: {}
      });
      const token = createSession(username);
      saveDb();
      setAuthCookie(res, token);
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
      setAuthCookie(res, token);
      sendJson(res, 200, { token, username });
      return;
    }

    if (req.method === 'GET' && req.url === '/api/bootstrap') {
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'Please register or log in first.' });
      sendJson(res, 200, {
        me: getPublicUser(session.username),
        servers: db.servers.map(sanitizeServer),
        users: db.users.map((u) => ({ username: u.username, avatar: u.avatar }))
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/servers') {
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'Please register or log in first.' });
      const { name } = await parseBody(req);
      if (!name || !name.trim()) return sendJson(res, 400, { error: 'Server name is required.' });

      const newServer = {
        id: crypto.randomUUID(),
        name: name.trim(),
        owner: session.username,
        categories: [
          {
            id: crypto.randomUUID(),
            name: 'ТЕКСТОВЫЕ КАНАЛЫ',
            channels: [
              {
                id: crypto.randomUUID(),
                name: 'general',
                messages: []
              }
            ]
          }
        ]
      };
      db.servers.push(newServer);
      saveDb();
      sendJson(res, 201, { server: sanitizeServer(newServer) });
      return;
    }

    if (req.method === 'POST' && req.url.match(/^\/api\/servers\/[^/]+\/categories$/)) {
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'Please register or log in first.' });
      const serverId = req.url.split('/')[3];
      const target = db.servers.find((s) => s.id === serverId);
      if (!target) return sendJson(res, 404, { error: 'Server not found.' });

      const { name } = await parseBody(req);
      if (!name || !name.trim()) return sendJson(res, 400, { error: 'Category name is required.' });
      const category = { id: crypto.randomUUID(), name: name.trim(), channels: [] };
      target.categories.push(category);
      saveDb();
      sendJson(res, 201, { category });
      return;
    }

    if (req.method === 'POST' && req.url.match(/^\/api\/servers\/[^/]+\/channels$/)) {
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'Please register or log in first.' });
      const serverId = req.url.split('/')[3];
      const target = db.servers.find((s) => s.id === serverId);
      if (!target) return sendJson(res, 404, { error: 'Server not found.' });
      const { name, categoryId } = await parseBody(req);
      if (!name || !name.trim()) return sendJson(res, 400, { error: 'Channel name is required.' });

      const normalized = name.trim().toLowerCase();
      const exists = target.categories.some((cat) =>
        cat.channels.some((c) => c.name.toLowerCase() === normalized)
      );
      if (exists) return sendJson(res, 409, { error: 'Channel already exists.' });

      const targetCategory = target.categories.find((cat) => cat.id === categoryId) || target.categories[0];
      const channel = { id: crypto.randomUUID(), name: name.trim(), messages: [] };
      targetCategory.channels.push(channel);
      saveDb();
      sendJson(res, 201, { channel, categoryId: targetCategory.id });
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

      const found = findChannel(target, channelId);
      if (!found) return sendJson(res, 404, { error: 'Channel not found.' });

      const { text, imageData } = await parseBody(req);
      const hasText = typeof text === 'string' && text.trim();
      const hasImage = isValidImageData(imageData);
      if (!hasText && !hasImage) return sendJson(res, 400, { error: 'Message text or image is required.' });
      if (imageData && !hasImage) return sendJson(res, 400, { error: 'Invalid image format.' });

      const encryptedText = hasText ? Buffer.from(text, 'utf-8').toString('base64') : '';
      const message = {
        id: crypto.randomUUID(),
        author: session.username,
        encryptedText,
        imageData: hasImage ? imageData : '',
        createdAt: new Date().toISOString()
      };
      found.channel.messages.push(message);
      saveDb();
      sendJson(res, 201, { message });
      return;
    }


    if (req.method === 'DELETE' && req.url.match(/^\/api\/servers\/[^/]+\/channels\/[^/]+\/messages\/[^/]+$/)) {
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'Please register or log in first.' });

      const parts = req.url.split('/');
      const serverId = parts[3];
      const channelId = parts[5];
      const messageId = parts[7];
      const target = db.servers.find((s) => s.id === serverId);
      if (!target) return sendJson(res, 404, { error: 'Server not found.' });
      const found = findChannel(target, channelId);
      if (!found) return sendJson(res, 404, { error: 'Channel not found.' });

      const message = found.channel.messages.find((m) => m.id === messageId);
      if (!message) return sendJson(res, 404, { error: 'Message not found.' });
      if (message.author !== session.username) return sendJson(res, 403, { error: 'You can delete only your messages.' });

      found.channel.messages = found.channel.messages.filter((m) => m.id !== messageId);
      saveDb();
      sendJson(res, 200, { ok: true });
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

      const { to, text, imageData } = await parseBody(req);
      const fromUser = getUserByName(session.username);
      const toUser = getUserByName(to);
      if (!toUser) return sendJson(res, 404, { error: 'User not found.' });
      if (!fromUser.friends.includes(toUser.username)) return sendJson(res, 403, { error: 'DM is allowed only with friends.' });
      const hasText = typeof text === 'string' && text.trim();
      const hasImage = isValidImageData(imageData);
      if (!hasText && !hasImage) return sendJson(res, 400, { error: 'Message text or image is required.' });
      if (imageData && !hasImage) return sendJson(res, 400, { error: 'Invalid image format.' });

      const roomId = getDmBetween(fromUser.username, toUser.username);
      const encryptedText = hasText ? Buffer.from(text, 'utf-8').toString('base64') : '';
      const message = {
        id: crypto.randomUUID(),
        author: fromUser.username,
        encryptedText,
        imageData: hasImage ? imageData : '',
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


    if (req.method === 'DELETE' && req.url.startsWith('/api/dm/messages?')) {
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'Please register or log in first.' });

      const url = new URL(req.url, `http://${req.headers.host}`);
      const withUser = url.searchParams.get('with');
      const messageId = url.searchParams.get('id');
      if (!withUser || !messageId) return sendJson(res, 400, { error: 'with and id are required.' });

      const me = getUserByName(session.username);
      const other = getUserByName(withUser);
      if (!other) return sendJson(res, 404, { error: 'User not found.' });
      if (!me.friends.includes(other.username)) return sendJson(res, 403, { error: 'DM is allowed only with friends.' });

      const roomId = getDmBetween(me.username, other.username);
      const dmMessage = (me.dms[roomId] || []).find((m) => m.id === messageId);
      if (!dmMessage) return sendJson(res, 404, { error: 'Message not found.' });
      if (dmMessage.author !== session.username) return sendJson(res, 403, { error: 'You can delete only your messages.' });

      me.dms[roomId] = (me.dms[roomId] || []).filter((m) => m.id !== messageId);
      other.dms[roomId] = (other.dms[roomId] || []).filter((m) => m.id !== messageId);
      saveDb();
      sendJson(res, 200, { ok: true });
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
