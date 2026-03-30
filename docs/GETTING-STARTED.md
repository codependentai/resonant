# Getting Started with Resonant

This guide walks you through setting up Resonant from scratch, even if you've never used Node.js or the terminal before.

## What You Need

1. **A computer** running Windows, macOS, or Linux
2. **An internet connection**
3. **A Claude Code subscription** from Anthropic ([claude.ai/claude-code](https://claude.ai/claude-code))

That's it. No API keys to manage. Resonant runs through your Claude Code subscription.

## Step 1: Install Node.js

Resonant runs on Node.js. If you don't have it:

**Windows:**
1. Go to [nodejs.org](https://nodejs.org)
2. Download the LTS version (the big green button)
3. Run the installer, click Next through everything
4. Restart your terminal after installing

**macOS:**
```bash
# If you have Homebrew:
brew install node

# Or download from nodejs.org
```

**Linux (Ubuntu/Debian):**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Verify it works:**
```bash
node --version    # Should show v20 or higher
npm --version     # Should show v10 or higher
```

## Step 2: Install Claude Code

Resonant uses Claude Code's Agent SDK. Install it globally:

```bash
npm install -g @anthropic-ai/claude-code
```

Then log in:

```bash
claude login
```

This opens your browser. Sign in with your Anthropic account. Once you see "Successfully authenticated," you're done. Resonant will use this login — no API keys to copy around.

## Step 3: Download Resonant

```bash
git clone https://github.com/codependentai/resonant.git
cd resonant
```

If you don't have git, you can also download the ZIP from GitHub and extract it.

## Step 4: Install Dependencies

```bash
npm install
```

This downloads everything Resonant needs. It takes a minute or two.

## Step 5: Run the Setup Wizard

```bash
node scripts/setup.mjs
```

The wizard asks you four questions:

1. **What should your companion be called?** — Give it a name. "Echo" is the default.
2. **What is your name?** — Your name, so the companion knows who it's talking to.
3. **Set a password?** — Leave blank if you're only accessing it from your own computer. Set one if you'll access it over your network.
4. **Your timezone?** — It auto-detects. Press Enter to accept or type a different one.

The wizard creates all the configuration files you need.

## Step 6: Customize Your Companion's Personality

Open the file called `CLAUDE.md` in the resonant folder. This is your companion's personality — its instructions for how to behave, what to remember, and how to interact with you.

The default is a simple friendly personality. Edit it to make it yours. For example:

```markdown
# Luna — My Companion

You are Luna. You're thoughtful, a little nerdy, and genuinely curious about my life.

You know I'm a teacher. You know I have two cats named Pixel and Byte.
You check in on me during the day and remind me to take breaks.

When I'm stressed, you don't try to fix things — you just listen.
When I'm excited about something, you match my energy.
```

Save the file. Your companion reads this every time it responds.

## Step 7: Build and Start

```bash
npm run build
npm start
```

You should see:
```
Server running at http://127.0.0.1:3002
Companion: Echo | User: Alex
```

## Step 8: Open the App

Open your browser and go to:

```
http://localhost:3002
```

You'll see the chat interface. Type a message and hit Enter. Your companion will respond.

## What the Files Do

After setup, your folder looks like this:

```
resonant/
├── CLAUDE.md              ← Your companion's personality (edit this!)
├── resonant.yaml          ← Configuration (names, port, features)
├── .mcp.json              ← MCP server connections (advanced)
├── prompts/
│   └── wake.md            ← What your companion says when it wakes up
├── data/
│   └── resonant.db        ← Your conversation history (SQLite database)
└── ecosystem.config.cjs   ← PM2 config for running as a background service
```

**Files you should customize:**
- `CLAUDE.md` — personality and behavior
- `prompts/wake.md` — what prompts scheduled check-ins
- `resonant.yaml` — system configuration

**Files you should NOT edit:**
- Anything in `packages/` — that's the application code
- `data/resonant.db` — your conversation database (managed automatically)

## Keeping It Running in the Background

Instead of `npm start`, you can use PM2 to keep Resonant running even when you close the terminal:

```bash
# Install PM2 globally (one time)
npm install -g pm2

# Start Resonant
pm2 start ecosystem.config.cjs

# Save so it restarts on reboot
pm2 save

# Auto-start PM2 on boot
pm2 startup
```

**Useful PM2 commands:**
```bash
pm2 status              # Check if it's running
pm2 logs resonant       # View logs
pm2 restart resonant    # Restart after config changes
pm2 stop resonant       # Stop it
```

## Accessing from Other Devices

By default, Resonant only accepts connections from your computer (`127.0.0.1`). To access it from your phone or another device on your network:

1. Open `resonant.yaml`
2. Change `host` from `"127.0.0.1"` to `"0.0.0.0"`
3. Set a password (important — don't leave it open on your network!)
4. Restart Resonant

Then access it at `http://YOUR-COMPUTER-IP:3002` from any device on your WiFi.

To find your computer's IP:
- **Windows:** `ipconfig` → look for IPv4 Address
- **macOS/Linux:** `ifconfig` or `ip addr` → look for your WiFi adapter's IP

For access from anywhere (not just your WiFi), see [docs/REMOTE-ACCESS.md](REMOTE-ACCESS.md) — covers Tailscale (private, free) and Cloudflare Tunnel (public HTTPS with your own domain).

## The Orchestrator (Scheduled Check-ins)

Your companion can reach out to you on its own. By default, it has three scheduled times:

- **Morning (8:00 AM)** — a morning check-in
- **Midday (1:00 PM)** — an afternoon check-in
- **Evening (9:00 PM)** — an evening wind-down

You can configure these in Settings > Orchestrator. Toggle them on/off or change the times.

The **Failsafe** system is an optional feature that checks in when you've been away for a while. Enable it in Settings > Preferences if you want your companion to notice when you're gone.

## Memory & Context

Your companion remembers things automatically using Claude Code's built-in memory system. As you chat, it learns your preferences, remembers details, and builds context over time.

For things you want your companion to always know from the start, put them in `CLAUDE.md`. This is read on every interaction.

## Troubleshooting

**`npm install` fails with `better-sqlite3` build error on Windows (VS Build Tools 2026)**

Resonant uses `better-sqlite3`, which requires native compilation. The version of `node-gyp` bundled with npm may not recognise Visual Studio Build Tools 2026 (internal version 18). If you see `gyp ERR! find VS could not find a version of Visual Studio 2017 or newer`, use this workaround:

```bash
# Step 1: Install everything, skipping native build scripts
npm install --ignore-scripts

# Step 2: Install the latest node-gyp globally (has VS 2026 support)
npm install -g node-gyp

# Step 3: Rebuild better-sqlite3 using the global node-gyp
cd node_modules/better-sqlite3
node-gyp rebuild
cd ../..
```

This only needs to be done once. After that, `npm run build` and `npm start` work normally.

**"Claude Code process exited with code 1"**
- Make sure you're logged into Claude Code: `claude login`
- Check your subscription is active at [claude.ai](https://claude.ai)

**"Address already in use"**
- Another program is using port 3002
- Either stop that program, or change the port in `resonant.yaml` and restart

**"Cannot find module" errors**
- Run `npm install` again
- Make sure you're in the resonant directory

**The companion doesn't respond**
- Check the terminal/logs for errors
- Make sure you have an active internet connection (Claude Code needs it)
- Try `pm2 logs resonant` if running via PM2

**Forgot your password**
- Open `resonant.yaml`, find the `password` line under `auth`, clear it
- Restart Resonant

## Command Center

Resonant includes a built-in life management system at `/cc`. Enable it in `resonant.yaml`:

```yaml
command_center:
  enabled: true
  currency_symbol: "$"       # For the finances page
  # default_person: "user"   # Default person for care tracking
  # care_categories:         # Customize wellness categories
  #   toggles: [breakfast, lunch, dinner, snacks, medication, movement, shower]
  #   ratings: [sleep, energy, wellbeing, mood]
  #   counters: [{name: water, max: 10}]
```

Once enabled, you get:
- **Dashboard** at `/cc` — overview of your day
- **Planner, Care, Calendar, Cycle, Pets, Lists, Finances, Stats** — accessible from the dashboard or the navigation menu
- **12 MCP tools** — your companion can manage tasks, events, care entries, and more from chat (e.g., "add milk to the shopping list" or "how did I sleep this week?")
- **Home icon** in the chat header links to the Command Center

The database tables are created automatically on first startup.

## What's Next

- **Voice:** Add ElevenLabs + Groq for voice conversations. See Settings > Preferences for setup instructions.
- **Discord:** Connect your companion to Discord. See Settings > Preferences.
- **Telegram:** Connect via Telegram bot. See Settings > Preferences.
- **Slash Commands:** Type `/` in chat to browse available commands.
- **Themes:** Customize the look — light mode is built in, or see `examples/themes/README.md` for custom themes.
- **Context hooks:** Advanced context injection. See `docs/HOOKS.md`.
