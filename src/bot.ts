import { Bot } from '@maxhub/max-bot-api';
import { findChatIdByTitle } from './chats.js';
import { config } from './config.js';
import { registerHandlers } from './handlers.js';
import { startMiniAppServer } from './miniapp-server.js';
import { startScheduler } from './scheduler.js';
import { countAllStudents, ensureSuperAdmins, resetDatabase } from './storage.js';
import { loadStudentsFromExcel } from './students.js';

const bot = new Bot(config.botToken);
registerHandlers(bot);

console.log('Bot is starting...');

if (process.env.RESET_DB === '1') {
  await resetDatabase();
}

await ensureSuperAdmins();

const studentsCount = await countAllStudents();
if (studentsCount === 0) {
  const loaded = await loadStudentsFromExcel();
  if (!loaded) console.warn('WARNING: students file was not loaded. Put inputclass.xlsx into input/');
}

const info = await bot.api.getMyInfo();
console.log(`Bot @${info.username} is running.`);

try {
  await bot.api.setMyCommands([
    { name: 'start', description: 'Старт — открыть меню' },
    { name: 'menu', description: 'Главное меню' },
  ]);
} catch (error) {
  console.warn('Failed to set bot commands:', error);
}

const tasksChatId = await findChatIdByTitle(bot.api, config.tasksChatTitle);
if (tasksChatId) console.log(`Tasks chat "${config.tasksChatTitle}" found: ${tasksChatId}`);
else console.warn(`WARNING: Chat "${config.tasksChatTitle}" not found. Add the bot to this chat.`);

const studentsChatId = await findChatIdByTitle(bot.api, config.studentsInfoChatTitle);
if (studentsChatId) console.log(`Students chat "${config.studentsInfoChatTitle}" found: ${studentsChatId}`);
else console.warn(`WARNING: Chat "${config.studentsInfoChatTitle}" not found. Add the bot to this chat.`);

startScheduler(bot);
startMiniAppServer(config.miniappPort, config.miniappDir);
if (config.miniappPublicUrl) {
  console.log(`Mini-app public URL (MAX settings): ${config.miniappPublicUrl}`);
}

async function runWithRestart(): Promise<void> {
  for (;;) {
    try {
      await bot.start();
    } catch (error) {
      console.error('Bot polling crashed, restarting in 5s:', error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

await runWithRestart();
