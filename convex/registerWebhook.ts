"use node";

import { internalAction } from "./_generated/server";

export const register = internalAction(async () => {
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const convexUrl = process.env.CONVEX_SITE_URL!;
  const webhookUrl = `${convexUrl}/telegram`;

  const base = `https://api.telegram.org/bot${token}`;

  const [webhookRes, descRes, shortDescRes] = await Promise.all([
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
  ]);

  const data = await webhookRes.json();
  console.log("Registered TG bot webhook:", data);
  console.log("setMyDescription:", await descRes.json());
  console.log("setMyShortDescription:", await shortDescRes.json());
  return data;
});
