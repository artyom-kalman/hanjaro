"use node";

import { internalAction } from "./_generated/server";

export const register = internalAction(async () => {
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const convexUrl = process.env.CONVEX_SITE_URL!;
  const webhookUrl = `${convexUrl}/telegram`;

  const res = await fetch(
    `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`,
  );
  const data = await res.json();
  console.log("Registered TG bot webhook:", data);
  return data;
});
