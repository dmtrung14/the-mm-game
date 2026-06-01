# The M&M Game

Quant-style candy trading for 2+ players.

## Rules

- Random pool of 6 colors — **mix is hidden** during play (only total left in the bag is shown).
- Each turn: guess **3 colors**; the game draws **3** from the pool.
- You win `min(your guess, draw)` per color; those leave the pool.
- Everyone starts with **$500 cash**. **Buy** M&Ms from other players for cash (no color-for-color swaps).
- Settlement prices are **hidden until the end**: each M&M of color `c` is worth `(initial_count[c] / total) × 600`.
- Final net worth = **cash + candy valued at settlement prices**.

## Run (Windows)

From the project folder in **PowerShell**:

```powershell
.\start.ps1
```

Open **http://127.0.0.1:8000**

If port 8000 is busy, stop the old server first (Ctrl+C in that terminal).

## Dev (UI hot reload)

Terminal 1:

```powershell
python -m pip install -r requirements.txt
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

Terminal 2:

```powershell
cd frontend
npm install
npm run dev
```

Open **http://127.0.0.1:5173**

## Layout

```
backend/     Python game logic + FastAPI + WebSocket
frontend/    React + Vite + Tailwind
start.ps1    Build UI and start server (Windows)
```
