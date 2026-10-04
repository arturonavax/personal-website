/// <reference types="@cloudflare/workers-types" />

export interface EmailEnv {
  DB: D1Database;
  DISCORD_WEBHOOK_URL?: string;
  SLACK_WEBHOOK_URL?: string;
}

export interface ForwardableEmailMessage {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream;
  setReject(reason: string): void;
  forward(rcptTo: string): Promise<void>;
}

export async function processIncomingEmail(
  message: ForwardableEmailMessage,
  env: EmailEnv,
  ctx: ExecutionContext,
): Promise<void> {
  const rawEmailText = await new Response(message.raw).text();
  const subject = message.headers.get("subject") || "(No Subject)";

  // Persist directly to D1
  const dbPromise = env.DB.prepare(
    `INSERT INTO contact_leads (from_email, subject, body, created_at)
     VALUES (?, ?, ?, datetime('now'))`,
  )
    .bind(message.from, subject, rawEmailText)
    .run();

  // Trigger instant notification webhook if configured
  const webhookUrl = env.DISCORD_WEBHOOK_URL || env.SLACK_WEBHOOK_URL;
  if (webhookUrl) {
    const webhookPromise = fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: `New Lead: ${subject}`,
            description: `**From:** \`${message.from}\`\n**Date:** ${new Date().toISOString()}`,
            color: 0x5865f2,
          },
        ],
      }),
    }).catch(() => {
      // Discard webhook transport errors to avoid worker crash
    });

    ctx.waitUntil(Promise.all([dbPromise, webhookPromise]));
  } else {
    ctx.waitUntil(dbPromise);
  }
}

export default {
  async email(
    message: ForwardableEmailMessage,
    env: EmailEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    await processIncomingEmail(message, env, ctx);
  },
};
