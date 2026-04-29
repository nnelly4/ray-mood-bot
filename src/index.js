import "dotenv/config";
import http from "http";
import OpenAI from "openai";
import { Markup, Telegraf } from "telegraf";
import {
  buildCharacterInstructions,
  buildModeInstructions,
  CHARACTER_PRESETS,
  getCharacterPreset
} from "./character.js";
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
  botBoundaries:
    process.env.BOT_BOUNDARIES || "не причиняет вред, не манипулирует, не притворяется человеком вне роли",
  memoryMaxMessages: Number(process.env.MEMORY_MAX_MESSAGES || 14),
  port: Number(process.env.PORT || 3000),
  webhookBaseUrl: process.env.WEBHOOK_BASE_URL || process.env.RENDER_EXTERNAL_URL || "",
  webhookSecret: process.env.WEBHOOK_SECRET || "telegram-webhook"
};

const openai = new OpenAI({ apiKey: config.openaiApiKey });
const bot = new Telegraf(config.telegramBotToken);
const webhookPath = `/${config.webhookSecret}`;
const isWebhookMode = Boolean(config.webhookBaseUrl);

const TELEGRAM_COMMANDS = [
  { command: "menu", description: "открыть меню" },
  { command: "characters", description: "сменить персонажа" },
  { command: "character", description: "выбрать персонажа вручную" },
  { command: "games", description: "показать игры персонажа" },
  { command: "game", description: "запустить игру" }
];

const CHARACTER_KEYS = ["ray", "luna", "vega", "mira"];

const CHARACTER_GAMES = {
  ray: [
    {
      key: "strange_question",
      label: "Странный вопрос",
      description: "Рэй кидает weird-but-deep вопрос"
    },
    {
      key: "read_me",
      label: "Разбери меня",
      description: "Рэй делает наблюдение по одной фразе"
    }
  ],
  luna: [
    {
      key: "fight",
      label: "Срач",
      description: "дружеская словесная драка с Каем"
    },
    {
      key: "roast_me",
      label: "Прожарь меня",
      description: "Кай прожаривает вас по теме"
    },
    {
      key: "dark_advice",
      label: "Черный совет",
      description: "мерзкий саркастичный совет на ситуацию"
    }
  ],
  vega: [
    {
      key: "destroy_argument",
      label: "Разнеси аргумент",
      description: "Вега красиво разбирает мнение"
    },
    {
      key: "what_do",
      label: "Что делать",
      description: "Вега быстро собирает план"
    }
  ],
  mira: [
    {
      key: "kill_phrase",
      label: "Уничтожь фразой",
      description: "Мира выдает ядовитую реплику"
    },
    {
      key: "flirt_or_poison",
      label: "Флирт или яд",
      description: "Мира решает: это флирт, кринж или яд"
    }
  ]
};

function buildPersistentMenuKeyboard() {
  return Markup.keyboard([["Меню", "Кто ты сейчас"], ["Сменить персонажа", "Игры"]]).resize();
}

function buildCharacterMenuText() {
  return [
    "Выбери персонажа:",
    "/character ray - Рэй, теплый и ироничный",
    "/character luna - Кай, дерзкий и черноюморный",
    "/character vega - Вега, сухой и умный",
    "/character mira - Мира, ехидная и стильная"
  ].join("\n");
}

function buildCharacterKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Рэй", "character:ray"),
      Markup.button.callback("Кай", "character:luna")
    ],
    [
      Markup.button.callback("Вега", "character:vega"),
      Markup.button.callback("Мира", "character:mira")
    ]
  ]);
}

function buildMainMenuText(currentPreset) {
  return [
    "Меню:",
    `Сейчас с тобой: ${currentPreset.label}`,
    "Нажимай, не нужно помнить слэши."
  ].join("\n");
}

function buildMainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Сменить персонажа", "menu:characters")],
    [Markup.button.callback("Игры", "menu:games")],
    [Markup.button.callback("Кто ты сейчас", "menu:whoami")]
  ]);
}

function buildGamesMenuText(preset) {
  const games = CHARACTER_GAMES[preset.key] || [];

  return [
    `Игры для ${preset.label}:`,
    ...games.map((game) => `• ${game.label} — ${game.description}`)
  ].join("\n");
}

function buildGamesKeyboard(preset) {
  const games = CHARACTER_GAMES[preset.key] || [];
  const rows = games.map((game) => [Markup.button.callback(game.label, `game:${game.key}`)]);
  rows.push([Markup.button.callback("Выключить игру", "game:off")]);
  return Markup.inlineKeyboard(rows);
}

function getEffectiveMode(conversation) {
  return conversation.characterKey === "luna" ? "roast" : "normal";
}

function getGameByKey(characterKey, gameKey) {
  return (CHARACTER_GAMES[characterKey] || []).find((game) => game.key === gameKey) || null;
}

async function updateConversation(userId, updater) {
  const current = await getConversation(userId);
  const next = updater(current);
  await saveConversation(userId, next);
  return next;
}

async function setCharacterForUser(userId, characterKey) {
  const preset = CHARACTER_PRESETS[characterKey];

  if (!preset) {
    return null;
  }

  await saveConversation(userId, {
    summary: "",
    messages: [],
    characterKey: preset.key,
    mode: getEffectiveMode({ characterKey: preset.key }),
    game: null
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

function getGameSystemContext(conversation, preset) {
  if (!conversation.game) {
    return "Активной игры нет.";
  }

  const contexts = {
    strange_question: `${preset.label} ведет игру "Странный вопрос". Задавай необычный, цепляющий вопрос и дальше поддерживай атмосферный странный диалог.`,
    read_me: `${preset.label} ведет игру "Разбери меня". По фразам пользователя делай наблюдения о его вайбе, характере и состоянии, но красиво и живо.`,
    fight: `${preset.label} ведет игру "Срач". Это дружеская словесная драка: отвечай коротко, едко, смешно и в тон.`,
    roast_me: `${preset.label} ведет игру "Прожарь меня". Пользователь сам просит прожарку, так что можно бить жестче, но смешно.`,
    dark_advice: `${preset.label} ведет игру "Черный совет". На любую ситуацию давай мерзкий, саркастичный, но смешной совет в стиле черного юмора.`,
    destroy_argument: `${preset.label} ведет игру "Разнеси аргумент". Красиво и умно разбирай тезис пользователя.`,
    what_do: `${preset.label} ведет игру "Что делать". Быстро собирай четкий план, но в характере Веги.`,
    kill_phrase: `${preset.label} ведет игру "Уничтожь фразой". На ситуацию пользователя выдавай одну-две эффектные ядовитые реплики.`,
    flirt_or_poison: `${preset.label} ведет игру "Флирт или яд". Определи, что несет пользователь: флирт, кринж или яд, и ответь красиво.`
  };

  return contexts[conversation.game] || `Активная игра: ${conversation.game}.`;
}

function getGameOpening(gameKey, preset) {
  const openings = {
    strange_question: `${preset.label} начинает. Вот вопрос: что в тебе выглядит как слабость, а на деле это твоя самая странная сила?`,
    read_me: `${preset.label} включил "Разбери меня". Кинь одну фразу о себе, а я разберу твой вайб.`,
    fight: `${preset.label} выходит на срач. Кидай первую подколку, посмотрим, насколько у тебя вообще есть зубы.`,
    roast_me: `${preset.label} готов прожарить. Назови тему: внешка, характер, переписки, работа, бывшие или что-то еще.`,
    dark_advice: `${preset.label} открывает "Черный совет". Опиши ситуацию, и я дам максимально мерзкий, но смешной совет.`,
    destroy_argument: `${preset.label} готов разносить. Напиши мнение или тезис, а я разберу его по винтикам.`,
    what_do: `${preset.label} на связи. Опиши проблему коротко, и я соберу план без лишней лирики.`,
    kill_phrase: `${preset.label} слушает. Кидай ситуацию, а я дам фразу, которой можно красиво уничтожить момент.`,
    flirt_or_poison: `${preset.label} смотрит на тебя с интересом. Кидай фразу, а я скажу, это флирт, кринж или чистый яд.`
  };

  return openings[gameKey] || "Игра не найдена.";
}

function buildUserProfile(ctx) {
  const firstName = ctx.from?.first_name || "Неизвестно";
  const username = ctx.from?.username ? `@${ctx.from.username}` : "без username";
  const languageCode = ctx.from?.language_code || "unknown";

  return `Имя: ${firstName}; Telegram: ${username}; Язык: ${languageCode}`;
}

function buildWhoAmIText(preset, conversation) {
  const currentGame = conversation.game ? conversation.game : "нет";
  const mode = getEffectiveMode(conversation);

  return [
    `Сейчас с тобой ${preset.label}.`,
    `Роль: ${preset.role}.`,
    `Текущий вайб: ${mode}.`,
    `Активная игра: ${currentGame}.`
  ].join("\n");
}

async function generateReply({ messageText, userProfile, conversation }) {
  const mood = detectMood(messageText);
  const moodGuidance = buildMoodGuidance(mood);
  const preset = getCharacterPreset(conversation.characterKey, config);
  const characterInstructions = buildCharacterInstructions(config, preset);
  const modeInstructions = buildModeInstructions(getEffectiveMode(conversation));
  const historyText = formatHistory(conversation.messages, preset.label);
  const summary = conversation.summary || "Краткой сводки пока нет.";
  const gameContext = getGameSystemContext(conversation, preset);

  const response = await openai.responses.create({
    model: config.openaiModel,
    instructions: [characterInstructions, modeInstructions].join("\n"),
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
              gameContext,
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
    reply:
      response.output_text?.trim() ||
      "Слова уже почти вылетели, но мысль решила красиво умереть в полете. Скажи еще раз.",
    mood
  };
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
  const { reply, mood } = await generateReply({
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
    characterKey: conversation.characterKey || "ray",
    mode: getEffectiveMode(conversation),
    game: conversation.game || null
  });

  await ctx.reply(reply, buildPersistentMenuKeyboard());
}

async function showMainMenu(ctx, userId) {
  const conversation = await getConversation(userId);
  const preset = getCharacterPreset(conversation.characterKey, config);
  await ctx.reply(buildMainMenuText(preset), buildMainMenuKeyboard());
  await ctx.reply("Нижние кнопки тоже активны.", buildPersistentMenuKeyboard());
}

async function showGamesMenu(ctx, userId) {
  const conversation = await getConversation(userId);
  const preset = getCharacterPreset(conversation.characterKey, config);
  await ctx.reply(buildGamesMenuText(preset), buildGamesKeyboard(preset));
  await ctx.reply("Выбирай игру кнопками или через нижнее меню.", buildPersistentMenuKeyboard());
}

bot.start(async (ctx) => {
  const userId = String(ctx.from?.id);
  const conversation = await getConversation(userId);
  const preset = getCharacterPreset(conversation.characterKey, config);
  const intro = [
    `Я ${preset.label}.`,
    `Вообще-то я ${preset.role}.`,
    "Пиши как есть. Я запоминаю тон, настроение и нить разговора."
  ].join(" ");

  await ctx.reply(intro, buildPersistentMenuKeyboard());
  await ctx.reply(buildCharacterMenuText(), buildCharacterKeyboard());
});

bot.command("menu", async (ctx) => {
  await showMainMenu(ctx, String(ctx.from?.id));
});

bot.command("characters", async (ctx) => {
  await ctx.reply(buildCharacterMenuText(), buildCharacterKeyboard());
  await ctx.reply("Нижнее меню тоже доступно.", buildPersistentMenuKeyboard());
});

bot.command("character", async (ctx) => {
  const userId = String(ctx.from?.id);
  const input = ctx.message?.text?.split(/\s+/)[1]?.toLowerCase();

  if (!input || !CHARACTER_PRESETS[input]) {
    await ctx.reply(buildCharacterMenuText(), buildCharacterKeyboard());
    await ctx.reply("Нижнее меню тоже доступно.", buildPersistentMenuKeyboard());
    return;
  }

  const preset = await setCharacterForUser(userId, input);
  await ctx.reply(`Теперь с тобой ${preset.label}. Можешь писать.`, buildPersistentMenuKeyboard());
});

bot.command("games", async (ctx) => {
  await showGamesMenu(ctx, String(ctx.from?.id));
});

bot.command("game", async (ctx) => {
  const userId = String(ctx.from?.id);
  const input = ctx.message?.text?.split(/\s+/)[1]?.toLowerCase();
  const current = await getConversation(userId);
  const preset = getCharacterPreset(current.characterKey, config);

  if (!input) {
    await showGamesMenu(ctx, userId);
    return;
  }

  if (input === "off") {
    await updateConversation(userId, (conversation) => ({
      ...conversation,
      game: null
    }));
    await ctx.reply("Игру выключил. Возвращаемся к обычному общению.", buildPersistentMenuKeyboard());
    return;
  }

  const game = getGameByKey(preset.key, input);

  if (!game) {
    await showGamesMenu(ctx, userId);
    return;
  }

  await updateConversation(userId, (conversation) => ({
    ...conversation,
    game: input
  }));

  await ctx.reply(getGameOpening(input, preset), buildPersistentMenuKeyboard());
});

bot.hears("Меню", async (ctx) => {
  await showMainMenu(ctx, String(ctx.from?.id));
});

bot.hears("Сменить персонажа", async (ctx) => {
  await ctx.reply(buildCharacterMenuText(), buildCharacterKeyboard());
  await ctx.reply("Нижнее меню тоже доступно.", buildPersistentMenuKeyboard());
});

bot.hears("Игры", async (ctx) => {
  await showGamesMenu(ctx, String(ctx.from?.id));
});

bot.hears("Кто ты сейчас", async (ctx) => {
  const userId = String(ctx.from?.id);
  const conversation = await getConversation(userId);
  const preset = getCharacterPreset(conversation.characterKey, config);
  await ctx.reply(buildWhoAmIText(preset, conversation), buildPersistentMenuKeyboard());
});

bot.action(/^menu:(characters|games|whoami)$/, async (ctx) => {
  const userId = String(ctx.from?.id);
  const action = ctx.match[1];

  await ctx.answerCbQuery();

  if (action === "characters") {
    await ctx.reply(buildCharacterMenuText(), buildCharacterKeyboard());
    await ctx.reply("Нижнее меню тоже доступно.", buildPersistentMenuKeyboard());
    return;
  }

  if (action === "games") {
    await showGamesMenu(ctx, userId);
    return;
  }

  const conversation = await getConversation(userId);
  const preset = getCharacterPreset(conversation.characterKey, config);
  await ctx.reply(buildWhoAmIText(preset, conversation), buildPersistentMenuKeyboard());
});

bot.action(/^character:(ray|luna|vega|mira)$/, async (ctx) => {
  const userId = String(ctx.from?.id);
  const characterKey = ctx.match[1];
  const preset = await setCharacterForUser(userId, characterKey);

  await ctx.answerCbQuery(`Выбрано: ${preset.label}`);
  await ctx.reply(`Теперь с тобой ${preset.label}. Можешь писать.`, buildPersistentMenuKeyboard());
});

bot.action(/^game:(.+)$/, async (ctx) => {
  const userId = String(ctx.from?.id);
  const gameKey = ctx.match[1];
  const conversation = await getConversation(userId);
  const preset = getCharacterPreset(conversation.characterKey, config);

  await ctx.answerCbQuery();

  if (gameKey === "off") {
    await updateConversation(userId, (current) => ({
      ...current,
      game: null
    }));
    await ctx.reply("Игру выключил. Возвращаемся к обычному общению.", buildPersistentMenuKeyboard());
    return;
  }

  const game = getGameByKey(preset.key, gameKey);

  if (!game) {
    await showGamesMenu(ctx, userId);
    return;
  }

  await updateConversation(userId, (current) => ({
    ...current,
    game: gameKey
  }));

  await ctx.reply(getGameOpening(gameKey, preset), buildPersistentMenuKeyboard());
});

bot.on("text", async (ctx) => {
  try {
    await handleTextMessage(ctx);
  } catch (error) {
    console.error("Message handling failed:", error);
    if (
      error?.status === 429 ||
      error?.code === "insufficient_quota" ||
      error?.error?.code === "insufficient_quota"
    ) {
      await ctx.reply(
        "Сейчас я молчу не из вредности: у OpenAI API закончилась квота. Нужно пополнить биллинг или включить доступ к API, и я снова заговорю.",
        buildPersistentMenuKeyboard()
      );
      return;
    }

    await ctx.reply(
      "У меня на секунду погас свет в голове. Напиши еще раз через пару секунд.",
      buildPersistentMenuKeyboard()
    );
  }
});

bot.catch((error) => {
  console.error("Telegram bot error:", error);
});

let isBotRunning = false;

async function startBot() {
  await bot.telegram.setMyCommands(TELEGRAM_COMMANDS);

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
