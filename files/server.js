// Rural Bank of Placer Inc. — Admin Department
// Office Supplies Inventory System — Backend Server
//
// All data is stored in a real file on disk (data/db.json), read and
// written by the server itself. That file is the single source of
// truth — every device that visits this server's URL sees the same
// data, and it survives reloads, logouts, and restarts.
//
// Deliberately uses only `express` and `cors` (no native/compiled
// dependencies) so it installs cleanly on virtually any Node host,
// including restrictive shared hosting.

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const DEFAULT_PASSWORD = 'placer2024';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

const app = express();
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// Tiny file-backed database
// ---------------------------------------------------------------------------
// Writes are serialized through a queue so concurrent requests can never
// interleave and corrupt the file, and every write goes to a temp file
// first then renames over the real one (atomic on POSIX filesystems),
// so a crash mid-write can't leave a half-written, unreadable file.

function loadDb(){
  if(!fs.existsSync(DB_PATH)){
    const salt = crypto.randomBytes(16).toString('hex');
    const initial = {
      items: [],
      passwordSalt: salt,
      passwordHash: hashPassword(DEFAULT_PASSWORD, salt),
      sessions: {}
    };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  try{
    return JSON.parse(raw);
  }catch(e){
    throw new Error('Database file is corrupted: ' + e.message);
  }
}

let writeQueue = Promise.resolve();
function persist(db){
  writeQueue = writeQueue.then(() => {
    const tmpPath = DB_PATH + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2));
    fs.renameSync(tmpPath, DB_PATH);
  });
  return writeQueue;
}

function hashPassword(plain, salt){
  return crypto.createHash('sha256').update(salt + ':' + plain).digest('hex');
}

// In-memory mirror, reloaded from disk on boot, kept in sync on every write.
let db = loadDb();

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------
function verifyPassword(plain){
  return hashPassword(plain, db.passwordSalt) === db.passwordHash;
}

async function changePassword(newPlain){
  const salt = crypto.randomBytes(16).toString('hex');
  db.passwordSalt = salt;
  db.passwordHash = hashPassword(newPlain, salt);
  await persist(db);
}

async function createSession(){
  const token = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  db.sessions[token] = { createdAt: now, expiresAt: now + SESSION_TTL_MS };
  await persist(db);
  return token;
}

function isValidSession(token){
  if(!token) return false;
  const session = db.sessions[token];
  if(!session) return false;
  if(session.expiresAt < Date.now()){
    delete db.sessions[token];
    persist(db); // fire-and-forget cleanup
    return false;
  }
  return true;
}

function requireAuth(req, res, next){
  const token = req.headers['x-session-token'];
  if(!isValidSession(token)){
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
  next();
}

// Periodic cleanup of expired sessions.
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for(const token of Object.keys(db.sessions)){
    if(db.sessions[token].expiresAt < now){
      delete db.sessions[token];
      changed = true;
    }
  }
  if(changed) persist(db);
}, 60 * 60 * 1000);

// ---------------------------------------------------------------------------
// Routes — Auth
// ---------------------------------------------------------------------------
app.post('/api/login', async (req, res) => {
  const { password } = req.body || {};
  if(typeof password !== 'string'){
    return res.status(400).json({ error: 'Password is required.' });
  }
  if(!verifyPassword(password)){
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  const token = await createSession();
  res.json({ token });
});

app.post('/api/logout', requireAuth, async (req, res) => {
  const token = req.headers['x-session-token'];
  delete db.sessions[token];
  await persist(db);
  res.json({ ok: true });
});

app.post('/api/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if(typeof currentPassword !== 'string' || typeof newPassword !== 'string'){
    return res.status(400).json({ error: 'Current and new password are required.' });
  }
  if(!verifyPassword(currentPassword)){
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  if(newPassword.length < 4){
    return res.status(400).json({ error: 'New password must be at least 4 characters.' });
  }
  await changePassword(newPassword);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Routes — Items (all require a valid session)
// ---------------------------------------------------------------------------
app.get('/api/items', requireAuth, (req, res) => {
  const sorted = [...db.items].sort((a, b) => a.name.localeCompare(b.name));
  res.json({ items: sorted });
});

app.post('/api/items', requireAuth, async (req, res) => {
  const { name, category, unit, qty, reorder, cost } = req.body || {};
  if(!name || !category || !unit){
    return res.status(400).json({ error: 'Name, category, and unit are required.' });
  }
  const now = new Date().toISOString();
  const item = {
    id: 'item_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex'),
    name: String(name).trim(),
    category: String(category).trim(),
    unit: String(unit).trim(),
    qty: parseInt(qty, 10) || 0,
    reorder: parseInt(reorder, 10) || 0,
    cost: parseFloat(cost) || 0,
    createdAt: now,
    updatedAt: now
  };
  db.items.push(item);
  await persist(db);
  res.status(201).json({ item });
});

app.put('/api/items/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const idx = db.items.findIndex(i => i.id === id);
  if(idx === -1){
    return res.status(404).json({ error: 'Item not found. It may have been removed by someone else.' });
  }
  const { name, category, unit, qty, reorder, cost } = req.body || {};
  if(!name || !category || !unit){
    return res.status(400).json({ error: 'Name, category, and unit are required.' });
  }
  db.items[idx] = {
    ...db.items[idx],
    name: String(name).trim(),
    category: String(category).trim(),
    unit: String(unit).trim(),
    qty: parseInt(qty, 10) || 0,
    reorder: parseInt(reorder, 10) || 0,
    cost: parseFloat(cost) || 0,
    updatedAt: new Date().toISOString()
  };
  await persist(db);
  res.json({ item: db.items[idx] });
});

app.delete('/api/items/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const idx = db.items.findIndex(i => i.id === id);
  if(idx === -1){
    return res.status(404).json({ error: 'Item not found. It may have already been removed.' });
  }
  db.items.splice(idx, 1);
  await persist(db);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Static frontend
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Rural Bank of Placer Inc. — Inventory System running on port ${PORT}`);
  console.log(`Database file: ${DB_PATH}`);
});
