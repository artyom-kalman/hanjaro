"use node";

import { internalAction } from "./_generated/server";

type Locale = {
  language_code?: string;
  description: string;
  short_description: string;
  commands: { command: string; description: string }[];
};

const LOCALES: Locale[] = [
  {
    // default — English
    description:
      "Look up Korean words with English translations and Hanja character breakdowns.",
    short_description: "Korean dictionary with Hanja breakdowns",
    commands: [
      { command: "start", description: "Start the bot" },
      { command: "settings", description: "Language" },
    ],
  },
  {
    language_code: "ru",
    description:
      "Поиск корейских слов с переводом и разбором иероглифов ханча.",
    short_description: "Корейский словарь с разбором ханча",
    commands: [
      { command: "start", description: "Запустить бота" },
      { command: "settings", description: "Язык" },
    ],
  },
];

export const register = internalAction(async () => {
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const convexUrl = process.env.CONVEX_SITE_URL!;
  const webhookUrl = `${convexUrl}/telegram`;

  const base = `https://api.telegram.org/bot${token}`;

  const post = (path: string, body: object) =>
    fetch(`${base}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const requests: Promise<Response>[] = [
    fetch(`${base}/setWebhook?url=${encodeURIComponent(webhookUrl)}`),
  ];
  const labels: string[] = ["setWebhook"];

  for (const loc of LOCALES) {
    const langTag = loc.language_code ? ` [${loc.language_code}]` : " [default]";
    const langField = loc.language_code ? { language_code: loc.language_code } : {};

    requests.push(post("setMyDescription", { description: loc.description, ...langField }));
    labels.push(`setMyDescription${langTag}`);

    requests.push(post("setMyShortDescription", { short_description: loc.short_description, ...langField }));
    labels.push(`setMyShortDescription${langTag}`);

    requests.push(post("setMyCommands", { commands: loc.commands, ...langField }));
    labels.push(`setMyCommands${langTag}`);
  }

  const responses = await Promise.all(requests);

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

  const results = await Promise.all(
    responses.map((res, i) => check(labels[i]!, res))
  );

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    throw new Error(
      `Telegram webhook registration failed: ${failed.map((f) => f.label).join(", ")}`,
    );
  }

  return results[0]!.body;
});
