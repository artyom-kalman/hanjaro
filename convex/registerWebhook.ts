"use node";

import { internalAction } from "./_generated/server";

export const register = internalAction(async () => {
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const convexUrl = process.env.CONVEX_SITE_URL!;
  const webhookUrl = `${convexUrl}/telegram`;

  const base = `https://api.telegram.org/bot${token}`;

  const [webhookRes, descRes, shortDescRes, commandsRes] = await Promise.all([
    fetch(`${base}/setWebhook?url=${encodeURIComponent(webhookUrl)}`),
    fetch(`${base}/setMyDescription`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "Look up Korean words with English translations and Hanja character breakdowns.",
      }),
    }),
    fetch(`${base}/setMyShortDescription`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        short_description: "Korean dictionary with Hanja breakdowns",
      }),
    }),
    fetch(`${base}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commands: [
          { command: "start", description: "Start the bot" },
        ],
      }),
    }),
  ]);

  const check = async (label: string, res: Response) => {
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      // leave body as null; handled below
    }
    const ok = res.ok && body && body.ok === true;
    if (!ok) {
      console.error(`Telegram ${label} failed:`, { status: res.status, body });
    } else {
      console.log(`Telegram ${label}:`, body);
    }
    return { label, ok, body };
  };

  const results = await Promise.all([
    check("setWebhook", webhookRes),
    check("setMyDescription", descRes),
    check("setMyShortDescription", shortDescRes),
    check("setMyCommands", commandsRes),
  ]);

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    throw new Error(
      `Telegram webhook registration failed: ${failed.map((f) => f.label).join(", ")}`,
    );
  }

  return results[0].body;
});
