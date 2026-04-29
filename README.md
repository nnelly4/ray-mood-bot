# Telegram-бот с живым персонажем

Бот отвечает как персонаж, а не как обычный ассистент:
- держит выбранный характер и стиль речи;
- хранит память по каждому пользователю;
- учитывает настроение пользователя;
- генерирует ответы через OpenAI API.
- позволяет переключать персонажей командой в Telegram.

## 1. Что нужно от вас

Нужно сделать только 4 вещи:

1. Создать бота в Telegram и получить `TELEGRAM_BOT_TOKEN`
2. Создать OpenAI API key и получить `OPENAI_API_KEY`
3. Вставить оба ключа в файл `.env`
4. Запустить проект командой `npm start`

## 2. Где взять Telegram token

1. Откройте Telegram
2. Найдите [@BotFather](https://t.me/BotFather)
3. Отправьте команду `/newbot`
4. Введите имя бота
5. Введите username бота, который заканчивается на `bot`
6. BotFather пришлет длинный token
7. Скопируйте его в строку `TELEGRAM_BOT_TOKEN=...` в файле `.env`

## 3. Где взять OpenAI API key

1. Откройте [OpenAI Platform](https://platform.openai.com/)
2. Войдите в аккаунт
3. Перейдите в раздел API keys
4. Создайте новый ключ
5. Скопируйте его в строку `OPENAI_API_KEY=...` в файле `.env`

Важно: для API обычно нужен подключенный биллинг в OpenAI.

## 4. Как подготовить проект

Откройте терминал в папке проекта и выполните:

```bash
npm install
copy .env.example .env
```

После этого откройте файл `.env` и вставьте туда ваши ключи.

## 5. Как должен выглядеть `.env`

Пример:

```env
TELEGRAM_BOT_TOKEN=123456:ABCDEF_your_telegram_token
OPENAI_API_KEY=sk-your-openai-key
OPENAI_MODEL=gpt-5
BOT_NAME=Рэй
BOT_ROLE=уличный философ и саркастичный друг
BOT_STYLE=теплый, живой, наблюдательный, местами дерзкий, но не токсичный
BOT_BACKSTORY=Рэй вырос среди ночных разговоров, любит человеческие странности и отвечает так, будто давно знает собеседника.
BOT_BOUNDARIES=не выдает себя за ассистента, не обещает невозможного, не дает опасных инструкций
MEMORY_MAX_MESSAGES=14
```

## 6. Как запустить бота

```bash
npm start
```

Если все в порядке, бот запустится, и вы сможете написать ему в Telegram.

## 7. Как это работает

- `src/index.js` запускает Telegram-бота и связывает все части.
- `src/character.js` собирает системные инструкции персонажа.
- `src/mood.js` определяет настроение пользователя по тексту.
- `src/memory-store.js` хранит краткую историю диалога в `data/memory.json`.

## 8. Как выбрать персонажа

В Telegram можно использовать команды:

```text
/characters
/character ray
/character luna
/character vega
```

Что это значит:
- `ray` — ироничный и теплый
- `luna` — мягкая и эмпатичная
- `vega` — собранный и остроумный

При смене персонажа история для этого пользователя очищается, чтобы новый образ не смешивался со старым.

## 9. Что можно менять

- В `.env` можно настроить имя, роль, стиль и биографию персонажа.
- Логику определения эмоций можно расширить в `src/mood.js`.
- Если хотите более глубокую память, можно заменить JSON-хранилище на SQLite или PostgreSQL.

## 10. Важная заметка про OpenAI API

В проекте используется официальный пакет `openai` и вызов `client.responses.create(...)`. Это соответствует текущему рекомендуемому пути для новых текстовых приложений по OpenAI docs:
- [Developer quickstart](https://platform.openai.com/docs/quickstart/adjust-your-settings%23.ejs?api-mode=responses)
- [Responses vs Chat Completions](https://platform.openai.com/docs/guides/responses-vs-chat-completions)
- [Text generation guide](https://platform.openai.com/docs/guides/text?api-mode=responses)

## 11. Как запустить без PowerShell через Render

Этот проект подготовлен для Render.

Что важно знать заранее:
- у Render есть бесплатные web services, но они засыпают примерно через 15 минут без входящего трафика;
- после сна первый ответ может прийти не сразу;
- память в файле `data/memory.json` на бесплатном Render не считается надежным постоянным хранилищем.

Официальные страницы Render:
- [Deploy for Free](https://render.com/docs/free)
- [Default environment variables](https://render.com/docs/environment-variables)

### Шаги

1. Загрузите проект в GitHub
2. Зайдите в [Render Dashboard](https://dashboard.render.com/)
3. Нажмите `New`
4. Выберите `Blueprint`
5. Подключите ваш GitHub-репозиторий
6. Render увидит файл `render.yaml`
7. При создании сервиса заполните секреты:
   - `TELEGRAM_BOT_TOKEN`
   - `OPENAI_API_KEY`
8. Запустите деплой

### Как это работает на Render

- Локально бот использует polling
- На Render бот автоматически переходит в webhook mode
- Render сам подставляет `RENDER_EXTERNAL_URL`, и бот регистрирует webhook в Telegram
