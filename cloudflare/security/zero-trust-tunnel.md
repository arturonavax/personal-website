# SPEC-003: Zero Trust & Tunneling Bastion Architecture

```
                                CLOUDFLARE ZERO TRUST
 [DEVELOPER MACHINE]                                                 [PUBLIC EDGE]
 localhost:4321 (Astro Staging) <──┐                                      │
 localhost:8080 (D1 Local Studio)<─┼─ cloudflared tunnel ───> edge.arturonavax.dev
                                   │                              │
                                   └───────── Cloudflare Access ──┘
                                              (GitHub OAuth + 2FA / WebAuthn)
```

## 1. Tunnel Creation & Configuration

```bash
# Authenticate cloudflared daemon
cloudflared tunnel login

# Create isolated staging tunnel
cloudflared tunnel create staging-tunnel

# Route DNS ingress through Cloudflare Edge
cloudflared tunnel route dns staging-tunnel staging.arturonavax.dev
```

## 2. Ingress Rules (`config.yml`)

```yaml
tunnel: staging-tunnel
credentials-file: /etc/cloudflared/credentials.json

ingress:
  - hostname: staging.arturonavax.dev
    service: http://localhost:4321
  - hostname: d1-studio.arturonavax.dev
    service: http://localhost:8080
  - service: http_status:404
```

## 3. Cloudflare Access Policy

- **Identity Provider:** GitHub OAuth
- **Evaluation Requirement:** 2FA / WebAuthn mandatory
- **Allowed Emails:** `arturo@arturonavax.dev`
- **Zero Open Ports:** All traffic traverses outbound WebSockets from developer machine to nearest Cloudflare PoP.
