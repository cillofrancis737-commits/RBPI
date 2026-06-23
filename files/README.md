# Rural Bank of Placer Inc. — Admin Department Inventory System

A centralized office supplies inventory system. Data lives in a real
database file on the server (`data/inventory.db`), so every device that
opens the site's URL sees the same, current data — adding an item on one
computer shows up immediately for everyone else, and nothing is lost on
logout, reload, or restart.

## What's inside

```
rbpi-inventory/
├── server.js          Backend (Express + SQLite)
├── package.json
├── public/
│   └── index.html     Frontend (talks to the backend via fetch)
└── data/
    └── inventory.db   Created automatically on first run
```

## Running it locally (to test before deploying)

Requires Node.js 18 or newer.

```bash
cd rbpi-inventory
npm install
npm start
```

Then open **http://localhost:3000** in a browser. Default password:
`placer2024` — change it from the toolbar after logging in.

## Deploying so it has a real URL

Any host that can run a Node.js app will work. A few common, low-effort
options:

### Render.com / Railway.app (easiest)
1. Push this folder to a GitHub repository.
2. Create a new "Web Service" and point it at the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Once deployed, you'll get a URL like `https://rbpi-inventory.onrender.com`.

**Important:** on most free/basic tiers, the filesystem (and therefore
`data/inventory.db`) is wiped on every redeploy or restart. For
production use with a host like this, mount a persistent disk/volume for
the `data/` folder (Render and Railway both offer this for a small fee),
or switch to a hosted database. Ask if you'd like the server adapted to
use a hosted Postgres/MySQL database instead of SQLite — that keeps data
safe regardless of how the app restarts.

### A VPS or on-prem server the bank already controls
1. Copy this folder to the server.
2. `npm install --production`
3. Run it with a process manager so it survives reboots, e.g.:
   ```bash
   npm install -g pm2
   pm2 start server.js --name rbpi-inventory
   pm2 save
   ```
4. Put it behind your existing reverse proxy / domain (Nginx, etc.) so it
   has a proper `https://` URL on your network.

### Shared hosting with Node support (e.g. cPanel "Setup Node.js App")
1. Upload the folder.
2. Point the app's entry file to `server.js`.
3. Run "npm install" through the cPanel Node interface.
4. Start the app from the cPanel panel.

## Security notes

- The password is stored as a salted hash, not plain text, in the
  database.
- Sessions expire automatically after 12 hours of being issued.
- This is single-shared-password access control suited for an internal
  department tool, not bank-grade authentication. For sensitive or
  regulated data, have your IT/compliance team review before relying on
  this for production records — consider per-user logins and HTTPS
  enforcement at the hosting level.
- Always serve this over HTTPS in production (most hosts above provide
  this automatically) so the password isn't sent in plain text over the
  network.

## Backing up your data

The entire inventory lives in `data/inventory.db`. Back this single file
up periodically (copy it somewhere safe) — restoring it is as simple as
putting the file back before starting the server.
