# Deploy to Render (Starter)

One **Web Service** serves the built React UI and the `/ws` WebSocket on the same URL.

**Cost:** Render Starter is about **$7/month** (always on; no sleep).  
**Scale:** Fine for ~100 concurrent players; game state is in memory on one instance.

---

## Before you start

1. Code is on **GitHub** (push this repo).
2. Test production locally:

   ```powershell
   .\start.ps1 -Prod
   ```

   Open the URL it prints; create a room and confirm the game works.

---

## Step 1 — Render account

1. Go to [https://render.com](https://render.com) and sign up.
2. Connect your **GitHub** account when prompted.

---

## Step 2 — Create the Web Service

### Option A — Blueprint (uses `render.yaml` in the repo)

1. Dashboard → **New +** → **Blueprint**.
2. Connect the **the-mm-game** repository.
3. Render reads `render.yaml` and proposes a service named **the-mm-game**.
4. On the plan step, choose **Starter** (not Free).
5. Click **Apply** / deploy.

### Option B — Manual (same settings as `render.yaml`)

1. Dashboard → **New +** → **Web Service**.
2. Connect your GitHub repo.
3. Set:

   | Field | Value |
   |--------|--------|
   | **Name** | `the-mm-game` (or anything) |
   | **Region** | Closest to your players |
   | **Branch** | `main` (or your default branch) |
   | **Root directory** | *(leave empty — repo root)* |
   | **Runtime** | `Python 3` |
   | **Build command** | `pip install -r requirements.txt && cd frontend && npm ci && npm run build` |
   | **Start command** | `uvicorn backend.main:app --host 0.0.0.0 --port $PORT` |
   | **Plan** | **Starter** |

4. **Environment variables** (optional but recommended):

   | Key | Value |
   |-----|--------|
   | `PYTHON_VERSION` | `3.12.3` |
   | `NODE_VERSION` | `20` |

5. Click **Create Web Service**.

---

## Step 3 — Wait for the first deploy

1. Open the service → **Logs**.
2. Build should:
   - `pip install -r requirements.txt`
   - `npm ci` + `npm run build` in `frontend/`
3. Start should show uvicorn listening on `$PORT`.
4. When status is **Live**, open the URL Render gives you, e.g.  
   `https://the-mm-game.onrender.com`

---

## Step 4 — Smoke test

1. Open the live URL in two browsers (or normal + incognito).
2. **Create** a room on one, **Join** with the code on the other.
3. **Start** as host, place a bid, draw a turn.
4. If WebSocket fails, check Logs for errors right after page load.

---

## Step 5 — Custom domain (optional)

1. Service → **Settings** → **Custom Domains**.
2. Add your domain (e.g. `mm.yourdomain.com`).
3. At your DNS host, add the **CNAME** Render shows.
4. Wait for TLS (automatic on Render).

---

## Updating the live site

1. Push to the connected branch on GitHub.
2. Render **auto-deploys** each push (default).
3. **Active games reset** on each deploy (in-memory rooms). Deploy when few people are playing, or accept a brief outage.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Build fails on `npm ci` | Check Logs; ensure `frontend/package-lock.json` is committed. |
| `Run .\start.ps1 to build the UI first` on live URL | Build did not produce `frontend/dist/` — fix build command / Node version. |
| Page loads but game won’t connect | Must use **Starter** (not Free). Free tier sleeps; WebSockets break. |
| Works locally, fails on Render | Confirm **Start command** uses `--host 0.0.0.0` and `$PORT`. |

---

## What not to use on Render for this app

- **Static Site** — no WebSocket / API.
- **Free** Web Service — sleeps after idle; bad for shared room links.
