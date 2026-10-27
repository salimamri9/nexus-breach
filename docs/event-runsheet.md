# Nexus Breach: event run sheet

Three parts: getting the server up, the playtest with friends, and the night itself.

---

## 1. Deploy the server

**One instance only.** The match lives in that single process.

### Sizing
60 players measured: **15–25 % of one CPU core, about 180 MB RAM, about 8 KB/s per player**, plus about 5 MB per player the first time they load the page (the prologue images and voices are most of it).

- **AWS:** a `t2.micro` (1 vCPU, 1 GB) runs it, but it's a *burstable* instance: above 10 % CPU it spends credits, and an hour at about 20 % is fine only if the credit balance is healthy. A **`t3.small`** (2 GB, "unlimited" bursting by default) removes the worry for a few cents. Either way, give it a public IP and open the port in the security group.
- **Render / Docker:** `render.yaml` and the `Dockerfile` work as-is (use the paid *starter* plan; free sleeps).

### Fast path: AWS in one command
Everything is scripted (`terraform/` + `scripts/`). Once, on your PC: `aws configure` (an IAM access key with EC2 rights).
```bash
scripts/aws-up.sh        # creates the server (Ubuntu 24.04, t3.small, Paris), deploys, prints the links + admin password
scripts/deploy.sh        # after changing the game: upload + restart (keeps the running match)
scripts/deploy.sh --fresh  # same, but wipes the saved match
scripts/aws-down.sh      # after the event: deletes the server and stops all charges
```
- **Your own domain + HTTPS:** add a DNS **A record** `your.domain → <public_ip>` (if your DNS is on Cloudflare, set it to *DNS only*, grey cloud), wait a few minutes, then `scripts/https.sh your.domain you@email` (free Let's Encrypt certificate that renews itself; plain http redirects to https). From then on use `https://your.domain/screen?join=https://your.domain/` on the projector.
- The server gets a **fixed public IP** (Elastic IP), nginx on port 80 with WebSockets, a systemd service that restarts the game in 1 s, and the match snapshot in `/var/lib/nexus/`.
- SSH is open **only to the IP you ran `aws-up.sh` from**. From somewhere else, re-run `scripts/aws-up.sh` there (it only updates the firewall).
- The admin password is generated once and kept in `~/.config/nexus-breach/admin_password` (and on the server); never in the repo.
- Cost (eu-west-3, t3.small, on-demand): about **$0.03/hour** all-in (instance + public IP + 16 GB disk), roughly $20 for a month left running. Run `aws-down.sh` when you're done.

### By hand on a fresh Ubuntu VM
```bash
# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
# the game (copy the folder over, without node_modules and data/)
cd ~/treasure_hunt_2d && npm ci --omit=dev
```

Keep it running and restart it on its own with **systemd** (`/etc/systemd/system/nexus.service`):
```ini
[Unit]
Description=Nexus Breach
After=network.target

[Service]
WorkingDirectory=/home/ubuntu/treasure_hunt_2d
Environment=ADMIN_PASSWORD=pick-a-long-one
Environment=PORT=3000
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=1
User=ubuntu

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload && sudo systemctl enable --now nexus
journalctl -u nexus -f          # live log
```
(Without systemd, `ADMIN_PASSWORD=… npm run event` does the same restart loop in a terminal.)

**Port:** open `3000` in the security group and players use `http://<public-ip>:3000`. For a domain + HTTPS, put nginx (or Caddy) in front and **forward WebSockets**:
```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
}
```

### Settings
| Variable | What it does |
|---|---|
| `ADMIN_PASSWORD` | **Required.** Without it the admin password is `nexus-admin`. |
| `PORT` | Default 3000. |
| `STATE_FILE` | Where the crash-safety snapshot goes (default `data/state.json`). |
| `FRESH=1` | Ignore the snapshot on boot (start clean). |
| `NEXUS_DEBUG` | **Never in production**: it lets clients teleport. |

### Check it
- `http://<server>/health` answers `{"ok":true}`.
- `/` (player), `/screen` (projector), `/admin` (you) all load.
- Optional load test from your PC: `npm run bots -- 60 http://<server>:3000` (watch CPU with `top` on the server). **Reset the match in the admin panel afterwards**: bots leave squads, scores and a snapshot behind.

---

## 2. Playtest with friends

Goal: find out if it's fun and fair, not whether it works (the bots proved that).

**Setup:** deploy as above, everyone on their own PC, one person on `/screen`, you on `/admin`. Start with **20–25 minutes** (Minutes box before *Start hunt*).

**Try on purpose**
- Start a squad, share the code, join with it. Try "Find me a squad" alone.
- One person per class; compare how they feel.
- Get caught on purpose; sprint until winded; hide under a car; throw bottles; cut a power relay.
- Trigger *The Hush in 12s*, *Supply drop now*, *Purge sweep now* from the admin panel.
- Reach the Core with 8 letters and try the upload while others contest it.

**Watch for and note down**
- Where people got stuck, and for how long (which terminal type?).
- Did anyone open the field manual (**H**)? Did they understand the squad code?
- Was being chased scary or annoying? Were drones too many / too few?
- Did the upload feel too long, too short, too easy to stall?

**What to change, in `config/game.json`** (restart the server after editing)

| Feels like… | Change | Now |
|---|---|---|
| Too long / too short a night | `durationMinutes` (or the Minutes box) | 50 |
| Drones everywhere / city too safe | `sentinels` | 45 |
| Can't reach the Core in time | `coreMinFragments` (letters needed) | 8 |
| Upload too hard / too easy | `coreUploadSeconds`, `uploadSecondsPerMissingLetter` | 90, 15 |
| Wrong Core guess too punishing | `coreLockoutSeconds` | 45 |
| Squads too big / small | `squadSize` | 4 |

Class numbers (speed, sprint, breath, flashlight) are in `CLASSES` in `shared/world.js`; stamina rules in `STAMINA_RULES` just below it. The class cards and field manual update themselves.

**After the playtest:** admin → **Reset with new map** (or restart with `FRESH=1`), so the event starts clean.

---

## 3. Event night

### The day before
- [ ] Server deployed, `/health` ok, `ADMIN_PASSWORD` set and written down somewhere safe.
- [ ] **No code changes from here on.** (A changed save format means a restart mid-event would lose the match.)
- [ ] Admin → **Reset with new map** so nothing from the playtest is left.

### 60 minutes before
- [ ] Projector PC: open **`/screen?join=http://<the address players use>`**, then **click the page once** (browsers block sound until a click; the prologue needs it), then **F11** for fullscreen. Check the QR code shows the right address, never `localhost`.
- [ ] Your PC: `/admin`, log in. Keep it open all night.
- [ ] Sound on the projector PC up; one test player joins from a PC in the room.

### As people arrive (lobby)
- Players open the address (or scan the QR), pick a callsign and class, and **start a squad** (friends join with its code) or **find a squad**. Max 4 per squad; the code is shown in their HUD.
- New players see the prologue once on their own screen. For the shared moment: **Prologue cinematic → Play on big screen** (or **+ every player**).
- Point everyone at **H** (field manual) while they wait in their base.

### Start
- Set **Minutes**, press **Start hunt** → 10 s countdown → the city unlocks.

### During
| Need | Admin panel |
|---|---|
| More time | **Add 5 min** |
| Liven things up | **Supply drop now**, **Purge sweep now**, **The Hush in 12s**, or type a line and **NEXUS speaks** |
| Tell everyone something | **Broadcast → Send to everyone** |
| Drones too brutal / a break | **Drones** toggle, or change **Count** and **Respawn drones** |
| A squad is stuck | **Terminals** table: hover to see each set's answer; the **Squads** table shows each squad's set |
| Friends split up | **Players** table → pick their squad |
| A group wants a squad ready before they sit down | **+ New squad** (open or code-only) → read them the code |
| Two half-empty squads want to team up | **Squads** table → **Merge into…** (max 4 together; they take the target squad's letters) |
| A squad wants its own name | **Squads** table → **Rename** (their code doesn't change) |
| Fix a score | **Squads** table → **+50 / −50** |
| Someone misbehaving | **Players** table → kick |

### The end
- The first squad to finish an upload wins; the game ends for everyone and the big screen shows the ending and ranking. Otherwise, at 0:00 the highest score wins. **End now** ends it early.
- The projector announces the winner and its side panel keeps the final ranking: take a photo of it.

### If something goes wrong
| Problem | Fix |
|---|---|
| Server crashed | systemd / `npm run event` restarts it in about 1 s; the match is restored from the last 3 s and players reconnect on their own. |
| A player's game froze or looks wrong | They refresh (F5): same squad, same score. |
| Laggy for one player | Graphics: LOW on the join screen (the game also suggests it). |
| Nobody hears the prologue | Click the projector page once, then play it again. |
| "Squad is full" for a friend | Squads hold 4. They start a new squad, or you move people in **Players**. |
| QR code shows `localhost` | Re-open `/screen?join=http://<public address>`. |
| Must restart the server by hand | `sudo systemctl restart nexus`: the match survives. Only `FRESH=1` or **Reset** wipes it. |
