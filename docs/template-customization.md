# Template Customization & Deployment Guide

This project is structured as a **world-class open source template** for Senior Software Engineers, Technical Architects, Consultants, and Engineering Leaders who want an ultra-fast, zero-overhead, highly polished personal brand platform.

Follow this guide to fork, customize, and deploy your own instance to Cloudflare in under 15 minutes.

---

## 1. Prerequisites

Before starting, ensure you have the following installed locally:
- **Node.js**: v22.0.0 or higher
- **pnpm**: v9.0.0 or higher (`npm install -g pnpm`)
- **Cloudflare CLI (`cf`)**: `npm install -g cf@latest`
- **Wrangler**: Installed locally in `devDependencies` (run via `pnpm exec wrangler`)
- **Bun**: (Optional, for running tests and audit scripts: `curl -fsSL https://bun.sh/install | bash`)
- **qpdf**: (Optional, for lossless PDF optimization: `sudo apt install qpdf` or `brew install qpdf`)

---

## 2. Quick Setup & Local Run

### Step 1: Fork and Clone
```sh
git clone https://github.com/<your-username>/personal-website.git
cd personal-website
pnpm install
```

### Step 2: Environment Configuration
Copy `.env.example` to `.env`:
```sh
cp .env.example .env
```

Review the key settings:
```ini
# Domain & General Configuration
SITE_URL="https://yourdomain.dev"
PUBLIC_SITE_URL="https://yourdomain.dev"

# R2 Content Storage (Optional for local testing; needed for remote sync)
R2_BUCKET_NAME="your-content-bucket"
CLOUDFLARE_ACCOUNT_ID="your_account_id"
R2_ACCESS_KEY_ID="your_r2_access_key"
R2_SECRET_ACCESS_KEY="your_r2_secret_key"

# Bot & Captcha Protection
TURNSTILE_SITE_KEY="your_turnstile_site_key"
TURNSTILE_SECRET_KEY="your_turnstile_secret_key"

# Contact Webhooks (Discord, Slack, or Telegram)
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
SLACK_WEBHOOK_URL=""
```

### Step 3: Run the Development Server
```sh
pnpm dev:local
```
The server will start on `http://0.0.0.0:4321`. Because `--host` is enabled by default, you can preview the site simultaneously on your mobile phone and local network by opening `http://<your-lan-ip>:4321`.

---

## 3. Customizing Your Personal Identity & Branding

### 3.1. General Metadata & Links
Edit `src/data/` to match your personal identity:
- `src/data/shortcuts.ts`: Global keyboard navigation commands (Ctrl+K, G+H, etc.).
- `src/data/sponsorships.ts`: Coffee / GitHub Sponsors links.
- `src/data/onlineJudges.ts`: Codeforces, LeetCode, Kaggle, GitHub handles.

### 3.2. Multilingual UI Strings
Edit `src/i18n/ui.ts` to customize labels, navigation titles, and footer copy in English and Spanish.

### 3.3. Headshot & Favicons
- Replace `src/assets/arturonava.jpg` with your own square portrait image.
- Replace `public/favicon.svg`, `public/favicon-48x48.png`, and `public/apple-touch-icon.png` with your personal logo or monogram.
- Update `public/site.webmanifest` with your name and theme color preferences.

---

## 4. Setting up Cloudflare Services

### 4.1. Create the R2 Bucket
Create a private R2 bucket for your editorial content:
```sh
cf r2 bucket create your-content-bucket
```

### 4.2. Create the D1 Database (Analytics)
```sh
pnpm exec wrangler d1 create your-website-analytics
```
Copy the generated `database_id` into your `wrangler.jsonc`:
```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "your-website-analytics",
    "database_id": "<your-database-id>",
    "migrations_dir": "./cloudflare/d1/migrations"
  }
]
```
Apply the database migrations:
```sh
pnpm exec wrangler d1 migrations apply your-website-analytics --remote
```

### 4.3. Configure `wrangler.jsonc`
Open `wrangler.jsonc` and update:
- `name`: Name of your Cloudflare Worker.
- `routes`: Set your domain patterns (e.g. `yourdomain.dev`, `admin.yourdomain.dev`, `blog.yourdomain.dev`).
- `r2_buckets`: Set `bucket_name` to your R2 bucket.

---

## 5. Adding Your Content

You can add Markdown and MDX files directly into `src/content/`:
- `src/content/posts/`: Technical articles and thoughts.
- `src/content/projects/`: Featured engineering case studies.
- `src/content/services/`: Consulting offerings and competencies.
- `src/content/experience/`: Work history and engineering roles.
- `src/content/resume/`: Structured JSON resume.
- `public/downloads/`: Your English and Spanish CV PDFs.

### Pushing Content to R2:
Once you have written or customized your content locally, upload it to your private R2 bucket:
```sh
pnpm content:push
```
To preview the files that would be uploaded first:
```sh
pnpm content:push:dry
```

---

## 6. Production Deployment

To build and deploy your site to Cloudflare Workers with Static Assets:

```sh
pnpm run deploy
```

The pre-deploy hook will:
1. Automatically pull the latest remote content from R2 if needed.
2. Compile the static site via Astro (`pnpm run build`).
3. Deploy the unified Worker and static assets to Cloudflare's Edge network via Wrangler.
