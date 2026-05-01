# Remote Access

Resonant starts as a local app. For a private companion deployment, the baseline remote-access layer is **Tailscale**. Cloudflare Tunnel is optional when you need a public HTTPS domain, easier PWA installation, or push-notification-compatible HTTPS.

Do not expose port `3002` directly to the public internet.

## Recommended Patterns

| Pattern | Use when | Public internet exposure |
| --- | --- | --- |
| Local network | You only use Resonant at home | LAN only |
| Tailscale | You want private access from your own devices | No public app URL |
| Tailscale + Cloudflare Tunnel | You need HTTPS/domain/PWA/push while keeping private admin access | Public hostname protected by Cloudflare Access and Resonant auth |
| Cloudflare-only | Advanced public deployment | Not recommended for personal companion installs unless you understand the risk |

Tailscale is not a technical dependency of Cloudflare Tunnel. It is the required safety baseline for the way Resonant should be deployed privately: it gives you a private management path even if DNS, Cloudflare, or the public hostname fails.

## Option 1: Local Network Only

Use this only on a trusted home network.

```yaml
server:
  host: "0.0.0.0"
auth:
  password: "your-password-here"
```

Restart Resonant, find your local IP, and open `http://192.168.x.x:3002` from another device on the same WiFi.

## Option 2: Tailscale (Private Default)

Tailscale creates a private network between your devices. It needs no router port forwarding and keeps Resonant reachable only inside your tailnet.

1. Install Tailscale on the computer running Resonant:
   - [tailscale.com/download](https://tailscale.com/download)
   - Linux quick install: `curl -fsSL https://tailscale.com/install.sh | sh`
2. Install Tailscale on your phone/tablet/other computers.
3. Sign in with the same Tailscale account.
4. Configure Resonant:

   ```yaml
   server:
     host: "0.0.0.0"
   auth:
     password: "set-a-strong-password"
   ```

5. Find your Tailscale IP:

   ```bash
   tailscale ip -4
   ```

6. Open `http://100.x.y.z:3002` from any Tailscale device.

Optional: enable MagicDNS in the Tailscale admin console and use `http://machine-name:3002`.

## Option 3: Cloudflare Tunnel (Optional HTTPS/Public Domain)

Cloudflare Tunnel maps a public HTTPS hostname such as `chat.yourdomain.com` to local Resonant without opening inbound router ports. Use it when you need a domain, browser-friendly HTTPS, PWA install, or push notifications.

For personal companion installs, use all of these together:

- Tailscale installed and working for private/admin access
- Resonant `auth.password`
- Cloudflare Access in front of the hostname
- `cors.origins` set to the public HTTPS URL

### Cloudflare Setup

Prerequisites:

- A domain on Cloudflare
- `cloudflared` installed
- Resonant running locally on `http://localhost:3002`

Install `cloudflared`:

```bash
# Windows
winget install Cloudflare.cloudflared

# macOS
brew install cloudflared

# Linux
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
```

Create and route a tunnel:

```bash
cloudflared tunnel login
cloudflared tunnel create resonant
cloudflared tunnel route dns resonant chat.yourdomain.com
```

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: YOUR-TUNNEL-ID
credentials-file: /path/to/.cloudflared/YOUR-TUNNEL-ID.json

ingress:
  - hostname: chat.yourdomain.com
    service: http://localhost:3002
  - service: http_status:404
```

Update `resonant.yaml`:

```yaml
server:
  host: "127.0.0.1"
auth:
  password: "set-a-strong-password"
cors:
  origins:
    - "https://chat.yourdomain.com"
```

In Cloudflare Zero Trust, create a self-hosted Access application for `chat.yourdomain.com` before relying on the tunnel. Add an Allow policy for only the email/device group that should reach the companion. Without Access, the hostname is available to the public internet and only Resonant's password stands between the world and your app.

Run the tunnel:

```bash
cloudflared tunnel run resonant
```

Install as a service:

```bash
# Windows, from an Administrator shell
cloudflared service install

# macOS/Linux
sudo cloudflared service install
```

## PWA and Push Notifications

Browser push and PWA install flows generally require HTTPS. Cloudflare Tunnel is the simplest public HTTPS path. After the tunnel is working:

1. Configure VAPID keys in `.env` or Settings.
2. Set `push.vapid_contact` to a real `mailto:` or HTTPS contact URI.
3. Open the Cloudflare URL on your phone.
4. Install the PWA from the browser menu.
5. Enable notifications from Settings.

## Security Checklist

- [ ] Tailscale is installed and verified for private/admin access.
- [ ] `auth.password` is set before exposing Resonant beyond localhost.
- [ ] Port `3002` is not forwarded directly from your router or VPS firewall.
- [ ] Cloudflare Access protects any public hostname.
- [ ] `cors.origins` includes the exact HTTPS origin you use.
- [ ] `.env`, `.mcp.json`, and provider tokens are not committed.
- [ ] PM2/system service logs are reviewed after configuration changes.

## References

- [Tailscale install docs](https://tailscale.com/docs/install)
- [Cloudflare Tunnel docs](https://developers.cloudflare.com/tunnel/)
- [Run cloudflared as a service](https://developers.cloudflare.com/tunnel/advanced/local-management/as-a-service/)
- [Cloudflare Access self-hosted apps](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-apps/)
