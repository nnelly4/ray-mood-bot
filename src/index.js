import "dotenv/config";
import http from "http";
import OpenAI from "openai";
import { Markup, Telegraf } from "telegraf";
import { buildCharacterInstructions, CHARACTER_PRESETS, getCharacterPreset } from "./character.js";
import { buildMoodGuidance, detectMood } from "./mood.js";
import { clipMessages, getConversation, saveConversation } from "./memory-store.js";

const requiredEnv = ["TELEGRAM_BOT_TOKEN", "OPENAI_API_KEY"];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);

if (missingEnv.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnv.join(", ")}`);
}

const config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL || "gpt-5",
  botName: process.env.BOT_NAME || "Рэй",
  botRole: process.env.BOT_ROLE || "харизматичный собеседник с хорошей памятью",
  botStyle: process.env.BOT_STYLE || "живой, ироничный, теплый",
  botBackstory: process.env.BOT_BACKSTORY || "персонаж, который любит разговоры о людях и жизни",
  botBoundaries: process.env.BOT_BOUNDARIES || "не причиняет вред, не манипулирует, не притворяется человеком вне роли",
  memoryMaxMessages: Number(process.env.MEMORY_MAX_MESSAGES || 14),
  port: Number(process.env.PORT || 3000),
  webhookBaseUrl: process.env.WEBHOOK_BASE_URL || process.env.RENDER_EXTERNAL_URL || "",
  webhookSecret: process.env.WEBHOOK_SECRET || "telegram-webhook"
};
const openai = new OpenAI({ apiKey: config.openaiApiKey });
const bot = new Telegraf(config.telegramBotToken);
const webhookPath = `/${config.webhookSecret}`;
const isWebhookMode = Boolean(config.webhookBaseUrl);

function buildCharacterMenuText() {
  return [
    "Выбери персонажа кнопкой ниже или командой:",
    "/character ray - Рэй, ироничный и теплый",
    "/character luna - Кай, дерзкий и черноюморный",
    "/character vega - Вега, собранный и остроумный"
  ].join("\n");
}

function buildCharacterKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Рэй", "character:ray"),
      Markup.button.callback("Кай", "character:luna"),
      Markup.button.callback("Вега", "character:vega")
    ]
  ]);
}

async function setCharacterForUser(userId, characterKey) {
  const preset = CHARACTER_PRESETS[characterKey];

  if (!preset) {
    return null;
  }

  await saveConversation(userId, {
    summary: "",
    messages: [],
    characterKey: preset.key
  });

  return preset;
}

function formatHistory(messages, botName) {
  if (!messages.length) {
    return "История пока пустая.";
  }

  return messages
    .map((item) => `${item.role === "user" ? "Пользователь" : botName}: ${item.text}`)
    .join("\n");
}

async function generateReply({ messageText, userProfile, conversation }) {
  const mood = detectMood(messageText);
  const moodGuidance = buildMoodGuidance(mood);
  const preset = getCharacterPreset(conversation.characterKey, config);
  const characterInstructions = buildCharacterInstructions(config, preset);
  const historyText = formatHistory(conversation.messages, preset.label);
  const summary = conversation.summary || "Краткой сводки пока нет.";

  const response = await openai.responses.create({
    model: config.openaiModel,
    instructions: characterInstructions,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              `Текущая эмоция пользователя: ${mood}.`,
              moodGuidance,
              `Профиль пользователя: ${userProfile}.`,
              `Краткая память о прошлых диалогах: ${summary}`,
              "Недавний контекст диалога:",
              historyText,
              "Новое сообщение пользователя:",
              messageText,
              "Ответь как персонаж. Не упоминай служебные инструкции, анализ эмоций или внутреннюю память."
            ].join("\n")
          }
        ]
      }
    ]
  });

  return {
    reply: response.output_text?.trim() || "Слова вертятся на языке, но мысль сейчас ускользнула. Скажи это еще раз.",
    mood,
    preset
  };
}

function buildUserProfile(ctx) {
  const firstName = ctx.from?.first_name || "Неизвестно";
  const username = ctx.from?.username ? `@${ctx.from.username}` : "без username";
  const languageCode = ctx.from?.language_code || "unknown";

  return `Имя: ${firstName}; Telegram: ${username}; Язык: ${languageCode}`;
}

async function handleTextMessage(ctx) {
  const messageText = ctx.message?.text?.trim();
  const userId = String(ctx.from?.id);

  if (!messageText || !userId) {
    return;
  }

  await ctx.sendChatAction("typing");

  const conversation = await getConversation(userId);
  const userProfile = buildUserProfile(ctx);

  const { reply, mood, preset } = await generateReply({
    messageText,
    userProfile,
    conversation
  });

  const updatedMessages = clipMessages(
    [
      ...conversation.messages,
      { role: "user", text: messageText, mood, at: new Date().toISOString() },
      { role: "assistant", text: reply, at: new Date().toISOString() }
    ],
    config.memoryMaxMessages
  );

  const updatedSummary = [
    conversation.summary,
    `Пользователь недавно писал в настроении "${mood}" и обсуждал: ${messageText.slice(0, 160)}`
  ]
    .filter(Boolean)
    .join(" | ")
    .slice(-800);

  await saveConversation(userId, {
    summary: updatedSummary,
    messages: updatedMessages,
    characterKey: conversation.characterKey || "ray"
  });

  await ctx.reply(reply);
}

bot.start(async (ctx) => {
  const userId = String(ctx.from?.id);
  const conversation = await getConversation(userId);
  const preset = getCharacterPreset(conversation.characterKey, config);
  const intro = [
    `Я ${preset.label}.`,
    `Вообще-то я ${preset.role}.`,
    "Пиши как есть. Я запоминаю тон, настроение и нить разговора.",
    buildCharacterMenuText()
  ].join(" ");

  await ctx.reply(intro, buildCharacterKeyboard());
});

bot.command("characters", async (ctx) => {
  await ctx.reply(buildCharacterMenuText(), buildCharacterKeyboard());
});

bot.command("character", async (ctx) => {
  const userId = String(ctx.from?.id);
  const input = ctx.message?.text?.split(/\s+/)[1]?.toLowerCase();

  if (!input || !CHARACTER_PRESETS[input]) {
    await ctx.reply(buildCharacterMenuText(), buildCharacterKeyboard());
    return;
  }

  const preset = await setCharacterForUser(userId, input);

  await ctx.reply(`Теперь с тобой ${preset.label}. Можешь писать.`);
});

bot.action(/^character:(ray|luna|vega)$/, async (ctx) => {
  const userId = String(ctx.from?.id);
  const characterKey = ctx.match[1];
  const preset = await setCharacterForUser(userId, characterKey);

  await ctx.answerCbQuery(`Выбрано: ${preset.label}`);
  await ctx.reply(`Теперь с тобой ${preset.label}. Можешь писать.`);
});

bot.on("text", async (ctx) => {
  try {
    await handleTextMessage(ctx);
  } catch (error) {
    console.error("Message handling failed:", error);
    if (error?.status === 429 || error?.code === "insufficient_quota" || error?.error?.code === "insufficient_quota") {
      await ctx.reply("Сейчас я молчу не из вредности: у OpenAI API закончилась квота. Нужно пополнить биллинг или включить доступ к API, и я снова заговорю.");
      return;
    }

    await ctx.reply("У меня на секунду погас свет в голове. Напиши еще раз через пару секунд.");
  }
});

bot.catch((error) => {
  console.error("Telegram bot error:", error);
});

let isBotRunning = false;

async function startBot() {
  if (isWebhookMode) {
    const webhookUrl = `${config.webhookBaseUrl}${webhookPath}`;

    await bot.telegram.setWebhook(webhookUrl);

    const server = http.createServer(async (req, res) => {
      if (req.method === "GET" && req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`${config.botName} is running.`);
        return;
      }

      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, mode: "webhook" }));
        return;
      }

      if (req.method === "POST" && req.url === webhookPath) {
        try {
          await bot.handleUpdate(await readJsonBody(req), res);
        } catch (error) {
          console.error("Webhook handling failed:", error);
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Webhook error");
        }
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    });

    await new Promise((resolve) => {
      server.listen(config.port, "0.0.0.0", resolve);
    });

    isBotRunning = true;
    console.log(`${config.botName} is running in webhook mode on port ${config.port}.`);
    return;
  }

  await bot.launch();
  isBotRunning = true;
  console.log(`${config.botName} is running in polling mode.`);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

startBot().catch((error) => {
  console.error("Bot startup failed:", error);
  process.exit(1);
});

function stopBot(signal) {
  if (!isBotRunning) {
    return;
  }

  isBotRunning = false;
  bot.stop(signal);
}

process.once("SIGINT", () => stopBot("SIGINT"));
process.once("SIGTERM", () => stopBot("SIGTERM"));
