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

Open **http://127.0.0.1:5173** — UI changes hot-reload; no restart needed.

The script starts the Vite dev server and the Python API (WebSocket is proxied through Vite).

Optional flags:

- `.\start.ps1 -Reload` — also restart the API when you edit Python files
- `.\start.ps1 -Prod` — build the UI once and serve everything from a single port (like production; restart required for UI edits)

If port 8000 is busy, the script picks another port and prints the URLs.

## Layout

```
backend/     Python game logic + FastAPI + WebSocket
frontend/    React + Vite + Tailwind
start.ps1    Dev server + API (default), or -Prod for single-port build
```
