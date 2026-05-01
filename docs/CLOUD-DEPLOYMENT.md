# Cloud Deployment (VPS)

Run Resonant on a VPS when you want your companion online even when your laptop is off. A VPS keeps the orchestrator, Discord, Telegram, push notifications, and scheduled work alive.

This guide assumes Ubuntu 24.04. It works on DigitalOcean, Hetzner, Vultr, Linode, and similar providers.

## Runtime Choice

Claude Code is the default full-featured runtime and the easiest VPS path today. OpenAI Codex is available experimentally if your local/VPS Codex auth is configured. OpenRouter settings and key storage exist in v2.2.0, but OpenRouter chat execution is still planned.

Cost depends on your VPS and runtime subscription or API billing. Resonant itself stores data locally in SQLite.

## Prerequisites

- Ubuntu 24.04 VPS with 1GB RAM minimum
- SSH access to the VPS
- A runtime login, usually Claude Code
- Tailscale account for private/admin access
- Optional Cloudflare domain for public HTTPS/PWA/push

## Step 1: Create a VPS

Create an Ubuntu 24.04 server. A 1GB RAM instance is enough to start; 2GB is more comfortable if the runtime spikes.

SSH in:

```bash
ssh root@YOUR_VPS_IP
```

## Step 2: Install System Dependencies

```bash
apt update && apt upgrade -y
apt install -y curl git build-essential

curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

npm install -g pm2
node --version
npm --version
```

## Step 3: Install and Authenticate Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```

If the VPS has a browser flow available:

```bash
claude login
claude -p "say hello"
```

For headless VPS setups, generate an OAuth token on a machine where Claude Code is already logged in:

```bash
claude setup-token
```

On the VPS, place the token in a protected environment file or PM2 ecosystem file:

```bash
echo 'export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-YOUR_TOKEN_HERE"' >> ~/.bashrc
source ~/.bashrc
chmod 600 ~/.bashrc
claude -p "say hello"
```

Treat this token like a password.

## Step 4: Install Resonant

```bash
git clone https://github.com/codependentai/resonant.git
cd resonant
npm install
node scripts/setup.mjs
```

The wizard creates `resonant.yaml`, `.env`, `.mcp.json`, `identity/`, prompts, and `ecosystem.config.cjs`.

For a VPS, keep Resonant bound to localhost when using Cloudflare Tunnel:

```yaml
server:
  host: "127.0.0.1"
  port: 3002

agent:
  cwd: "/root/resonant"
```

If you use Tailscale-only access, set `host: "0.0.0.0"` and keep a strong `auth.password`.

## Step 5: Build and Run with PM2

```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
pm2 logs resonant --lines 20 --nostream
```

If PM2 needs runtime environment variables, add them to `ecosystem.config.cjs` and protect the file:

```bash
chmod 600 ecosystem.config.cjs
pm2 restart resonant --update-env
```

## Step 6: Install Tailscale (Required Private/Admin Layer)

Tailscale is the baseline for private companion deployments. It gives you a private management path that does not depend on public DNS or a Cloudflare hostname.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
tailscale ip -4
```

For Tailscale-only access:

```yaml
server:
  host: "0.0.0.0"
auth:
  password: "set-a-strong-password"
```

Then open `http://YOUR_TAILSCALE_IP:3002` from another Tailscale device.

## Step 7: Optional Cloudflare Tunnel for HTTPS

Use Cloudflare Tunnel when you need a public HTTPS hostname for PWA installation, web push, or a friendly domain. Tailscale is still your private/admin path.

Install `cloudflared`:

```bash
curl -L --output /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
dpkg -i /tmp/cloudflared.deb
```

Create the tunnel:

```bash
cloudflared tunnel login
cloudflared tunnel create resonant
cloudflared tunnel route dns resonant companion.yourdomain.com
```

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: YOUR_TUNNEL_ID
credentials-file: /root/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: companion.yourdomain.com
    service: http://localhost:3002
  - service: http_status:404
```

Set Resonant config:

```yaml
server:
  host: "127.0.0.1"
auth:
  password: "set-a-strong-password"
cors:
  origins:
    - "https://companion.yourdomain.com"
```

In Cloudflare Zero Trust, create a self-hosted Access application for `companion.yourdomain.com` and add an Allow policy for only the people/devices that should reach it. Do this before treating the public hostname as safe.

Run and install as a service:

```bash
cloudflared tunnel run resonant
cloudflared service install
```

## Common Operations

Update:

```bash
cd /root/resonant
git pull
npm install
npm run build
pm2 restart resonant --update-env
```

Logs:

```bash
pm2 logs resonant
pm2 logs resonant --lines 50 --nostream
```

Backup:

```bash
cp /root/resonant/data/resonant.db /root/resonant-backup-$(date +%Y%m%d).db
tar -czf /root/resonant-config-$(date +%Y%m%d).tgz resonant.yaml identity prompts .mcp.json .env
```

## Troubleshooting

**Runtime says not logged in**

```bash
claude -p "hello"
echo $CLAUDE_CODE_OAUTH_TOKEN | head -c 20
pm2 restart resonant --update-env
```

**WebSocket or CORS issues**

Make sure `cors.origins` contains the exact HTTPS origin, including protocol. Restart after editing `resonant.yaml`.

**Out of memory**

```bash
free -h
pm2 monit
```

Upgrade to a 2GB VPS or add swap if runtime calls crash under load.

**Tunnel not working**

```bash
ps aux | grep cloudflared
cloudflared tunnel run resonant
```

Also confirm the Cloudflare Access app and DNS route target the same hostname.

## Security Checklist

- [ ] Tailscale is installed and verified for private/admin access.
- [ ] `auth.password` is set.
- [ ] Resonant is not exposed directly on a public IP.
- [ ] Cloudflare Access protects any public hostname.
- [ ] `cors.origins` includes the public HTTPS URL.
- [ ] `.env`, `.mcp.json`, `.claude.json`, OAuth tokens, and `ecosystem.config.cjs` are `chmod 600`.
- [ ] Firewall exposes only what is needed: usually SSH and outbound tunnel connections.
- [ ] OAuth/API tokens are rotated if leaked.

## References

- [Tailscale install docs](https://tailscale.com/docs/install)
- [Cloudflare Tunnel docs](https://developers.cloudflare.com/tunnel/)
- [Run cloudflared as a service](https://developers.cloudflare.com/tunnel/advanced/local-management/as-a-service/)
- [Cloudflare Access self-hosted apps](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-apps/)
