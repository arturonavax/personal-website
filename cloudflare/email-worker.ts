/// <reference types="@cloudflare/workers-types" />
import { readBoundedBody } from "./runtime/request-body";

export interface EmailEnv {
  DB: D1Database;
  DISCORD_WEBHOOK_URL?: string;
  SLACK_WEBHOOK_URL?: string;
}

// rawSize is provided by the Email Workers binding; raw is still independently
// counted, as a declared size alone cannot authorize buffering.
export interface ForwardableEmailMessage {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  setReject(reason: string): void;
  forward(rcptTo: string): Promise<unknown>;
}

const MAX_EMAIL_BYTES = 64 * 1024;
const MAX_SUBJECT = 200;
const MAX_BODY = 16 * 1024;

export async function processIncomingEmail(
  message: ForwardableEmailMessage,
  env: EmailEnv,
  ctx: ExecutionContext,
): Promise<void> {
  if (message.rawSize > MAX_EMAIL_BYTES) {
    message.setReject("Message exceeds 64 KiB limit");
    return;
  }
  const headers = new Headers({ "content-length": String(message.rawSize) });
  let text: string | null;
  try {
    text = await readBoundedBody({ headers, body: message.raw }, MAX_EMAIL_BYTES);
  } catch {
    message.setReject("Unable to read message");
    return;
  }
  if (text === null) {
    message.setReject("Message exceeds 64 KiB limit");
    return;
  }
  const subject = (message.headers.get("subject") || "(No Subject)").slice(0, MAX_SUBJECT);
  const body = text.slice(0, MAX_BODY);
  const work = (async () => {
    try {
      await env.DB.prepare(
        `INSERT INTO contact_leads (from_email, subject, body, created_at)
         VALUES (?, ?, ?, datetime('now'))`,
      ).bind(message.from, subject, body).run();
    } catch {
      console.error("[email] D1 lead persistence failed");
      return; // A notification must not imply a persisted lead.
    }
    const webhookUrl = env.DISCORD_WEBHOOK_URL || env.SLACK_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ embeds: [{
            title: `New Lead: ${subject}`,
            description: `**From:** \`${message.from}\`\n**Date:** ${new Date().toISOString()}`,
            color: 0x5865f2,
          }] }),
        });
        if (!response.ok) console.error("[email] Notification delivery failed");
      } catch {
        console.error("[email] Notification delivery failed");
      }
    }
  })();
  ctx.waitUntil(work);
}

export default {
  async email(message: ForwardableEmailMessage, env: EmailEnv, ctx: ExecutionContext): Promise<void> {
    await processIncomingEmail(message, env, ctx);
  },
};
