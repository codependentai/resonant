# Cloud Deployment (VPS)

Run Resonant on a VPS so your companion stays online even when your computer is off. This guide covers setting up a DigitalOcean Droplet, but works on any Ubuntu VPS (Hetzner, Vultr, Linode, etc.).

## Why a VPS?

Resonant runs on your machine by default. That means when your laptop sleeps, your companion sleeps. A VPS keeps it running 24/7 — the orchestrator fires on schedule, Discord and Telegram stay connected, and you can access it from anywhere.

**Cost:** $4–6/month for a basic VPS. No additional API costs — Resonant uses your Claude Code subscription.

## Prerequisites

- A Claude Code subscription (Pro or Max)
- A VPS with Ubuntu 24.04 (1GB RAM is enough)
- A domain name (optional, for HTTPS access)

## Step 1: Generate Your OAuth Token

On your local machine (where you're already logged into Claude Code):

```bash
claude setup-token
```

This opens your browser. Authenticate, and it prints a token starting with `sk-ant-oat01-...`. **Save this token** — you'll need it on the VPS. It's valid for 1 year.

Also grab your account info:

```bash
cat ~/.claude.json
```

Note the `accountUuid` and `emailAddress`.

## Step 2: Create a VPS

### DigitalOcean

1. Sign up at [digitalocean.com](https://www.digitalocean.com)
2. **Create** → **Droplets**
3. Region: pick one close to you
4. Image: **Ubuntu 24.04 LTS**
5. Size: **Basic** → **Regular** → **$6/month** (1GB RAM, 1 vCPU, 25GB SSD)
6. Authentication: **Password** (simplest to start)
7. Create

You'll get an IP address. SSH in:

```bash
ssh root@YOUR_IP
```

(First login may ask you to change the root password.)

### Other Providers

- **Hetzner:** CX23 at €3.49/month (requires ID verification)
- **Vultr:** $6/month, credit card only
- **Linode:** $5/month, credit card only

Any Ubuntu 24.04 VPS works.

## Step 3: Install Dependencies

SSH into your VPS and run:

```bash
# System updates
apt update && apt upgrade -y
apt install -y curl git build-essential

# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# PM2 (process manager)
npm install -g pm2

# Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Verify
node --version    # Should show v22+
claude --version  # Should show Claude Code version
```

## Step 4: Set Up Claude Code Authentication

Create the auth config:

```bash
cat > ~/.claude.json << 'EOF'
{
  "hasCompletedOnboarding": true,
  "lastOnboardingVersion": "2.1.79",
  "oauthAccount": {
    "accountUuid": "YOUR_ACCOUNT_UUID",
    "emailAddress": "YOUR_EMAIL"
  }
}
EOF
chmod 600 ~/.claude.json
```

Add the OAuth token to your environment:

```bash
echo 'export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-YOUR_TOKEN_HERE"' >> ~/.bashrc
source ~/.bashrc
chmod 600 ~/.bashrc
```

**Test it works:**

```bash
claude -p "say hello"
```

You should get a response. If it says "Not logged in", double-check the token and `.claude.json`.

## Step 5: Clone and Configure Resonant

```bash
git clone https://github.com/codependentai/resonant.git
cd resonant
npm install
node scripts/setup.mjs    # Interactive setup wizard
```

The wizard creates your `resonant.yaml`, `CLAUDE.md`, prompts, and `.mcp.json`.

### Important Config for VPS

Edit `resonant.yaml` and make sure:

```yaml
server:
  host: "127.0.0.1"    # Keep localhost — tunnel handles external access
  port: 3002

agent:
  cwd: "/root/resonant"  # Or wherever you cloned it — absolute path
```

### Environment for PM2

PM2 doesn't source `.bashrc` automatically. Create an ecosystem config that includes the token:

```bash
cat > ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [{
    name: 'resonant',
    script: 'packages/backend/dist/server.js',
    cwd: '/root/resonant',
    env: {
      NODE_ENV: 'production',
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-YOUR_TOKEN_HERE',
    },
    autorestart: true,
    max_restarts: 10,
    restart_delay: 3000,
    max_memory_restart: '800M',
  }]
};
EOF
chmod 600 ecosystem.config.cjs
```

## Step 6: Build and Start

```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup    # Auto-start on reboot
```

**Verify it's running:**

```bash
pm2 logs resonant --lines 20 --nostream
```

You should see:
```
Server running at http://127.0.0.1:3002
Companion: Echo | User: Alex
```

## Step 7: Set Up HTTPS Access

Your companion is running on `localhost:3002`. To access it from outside, you need a tunnel or reverse proxy.

### Option A: Cloudflare Tunnel (Recommended)

Gives you a proper HTTPS domain. Requires a Cloudflare account with a domain.

```bash
# Install cloudflared
curl -L --output /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
dpkg -i /tmp/cloudflared.deb

# Authenticate (opens a URL — copy it to your browser)
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create resonant

# Note the tunnel ID, then configure:
cat > ~/.cloudflared/config.yml << EOF
tunnel: YOUR_TUNNEL_ID
credentials-file: /root/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: companion.yourdomain.com
    service: http://localhost:3002
  - service: http_status:404
EOF

# Add DNS record
cloudflared tunnel route dns resonant companion.yourdomain.com

# Add the domain to CORS in resonant.yaml:
# cors:
#   origins:
#     - "https://companion.yourdomain.com"

# Rebuild after config change
npm run build --workspace=packages/backend

# Start tunnel
cloudflared tunnel run resonant

# Install as system service (auto-start on reboot)
cloudflared service install
```

### Option B: Tailscale (Private Access)

No domain needed. Access from any device on your Tailscale network.

```bash
# Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up

# Get your Tailscale IP
tailscale ip -4

# Update resonant.yaml
# server:
#   host: "0.0.0.0"
# auth:
#   password: "set-a-password"
```

Access at `http://YOUR_TAILSCALE_IP:3002` from any Tailscale device.

### Option C: Direct IP (Not Recommended)

Only for testing. No HTTPS.

```bash
# Update resonant.yaml
# server:
#   host: "0.0.0.0"
# auth:
#   password: "set-a-strong-password"
```

Access at `http://YOUR_VPS_IP:3002`. **Not secure** — no encryption.

## Common Operations

### Update Resonant

```bash
cd /root/resonant
git pull
npm run build
pm2 restart resonant
```

### View Logs

```bash
pm2 logs resonant              # Live tail
pm2 logs resonant --lines 50 --nostream  # Last 50 lines
```

### Restart

```bash
pm2 restart resonant
```

After changing the OAuth token or `.env`:
```bash
pm2 restart resonant --update-env
```

### Check Status

```bash
pm2 status
pm2 monit    # Live CPU/memory monitor
```

### Backup Database

```bash
cp /root/resonant/data/resonant.db /root/resonant-backup-$(date +%Y%m%d).db
```

## Troubleshooting

### "Not logged in" / Agent SDK errors

The OAuth token isn't reaching the process.

```bash
# Verify token is set
echo $CLAUDE_CODE_OAUTH_TOKEN | head -c 20

# Test CLI directly
claude -p "hello"

# If PM2 doesn't have it, restart with --update-env
export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-..."
pm2 restart resonant --update-env
```

### Messages don't send (WebSocket issues)

Check the Content Security Policy. Your domain must be in the CSP `connect-src` directive. This is set in `packages/backend/src/server.ts` — look for `connectSrc`. Add your domain as `wss://yourdomain.com`, rebuild, restart.

Also check CORS origins in `packages/backend/src/services/ws.ts` and `resonant.yaml`.

### Out of memory

The $6 Droplet has 1GB RAM. Resonant idles at ~95MB, but Agent SDK queries spike higher.

```bash
free -h          # Check available memory
pm2 monit        # Watch live
```

If it crashes, upgrade to a 2GB Droplet ($12/month) or add swap:

```bash
fallocate -l 1G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### Token expired

Tokens last 1 year. When it expires:

1. On a machine with a browser: `claude setup-token`
2. Copy the new token to the VPS
3. Update `.bashrc`, `.profile`, and `ecosystem.config.cjs`
4. `pm2 restart resonant --update-env`

### Tunnel not working

```bash
# Check if cloudflared is running
ps aux | grep cloudflared

# Check logs
cat /var/log/cloudflared.log

# Restart
cloudflared tunnel run resonant
```

## Security Checklist

- [ ] Set a strong password in `resonant.yaml` (`auth.password`)
- [ ] Use HTTPS (Cloudflare Tunnel or Tailscale) — never expose HTTP directly
- [ ] File permissions: `chmod 600` on `.env`, `.bashrc`, `.claude.json`, `ecosystem.config.cjs`
- [ ] Keep Node.js updated: `apt update && apt upgrade`
- [ ] The OAuth token is as powerful as your Claude Code login — treat it like a password
- [ ] Firewall: only ports 22 (SSH) and 443 (HTTPS via tunnel) need to be open
