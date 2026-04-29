import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const DATA_FILE = path.join(DATA_DIR, "memory.json");

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify({}, null, 2), "utf8");
  }
}

async function readStore() {
  await ensureStore();
  const raw = await fs.readFile(DATA_FILE, "utf8");
  return JSON.parse(raw);
}

async function writeStore(store) {
  await ensureStore();
  await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
}

export async function getConversation(userId) {
  const store = await readStore();
  return store[userId] ?? { summary: "", messages: [], characterKey: "ray" };
}

export async function saveConversation(userId, conversation) {
  const store = await readStore();
  store[userId] = conversation;
  await writeStore(store);
}

export function clipMessages(messages, maxMessages) {
  return messages.slice(-maxMessages);
}
