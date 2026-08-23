import type { Bot } from '@maxhub/max-bot-api';
import { getEmployee, getTeachers, notMarkedClasses, cleanAbsents } from './storage.js';

function nowParts() {
  const now = new Date();
  return {
    weekday: now.getDay(),
    hour: now.getHours(),
    minute: now.getMinutes(),
  };
}

async function notifyTeachers(bot: Bot, text: string): Promise<void> {
  for (const employeeId of await getTeachers()) {
    const employee = await getEmployee(employeeId);
    if (!employee) continue;
    try {
      await bot.api.sendMessageToUser(employee.userId, text);
    } catch (error) {
      console.error(`Failed to mail teacher ${employee.userId}:`, error);
    }
  }
}

export function startScheduler(bot: Bot): void {
  let lastMailKey = '';
  let lastCleanKey = '';

  setInterval(async () => {
    const { weekday, hour, minute } = nowParts();
    const mailKey = `${weekday}-${hour}-${minute}`;

    if (weekday !== 0) {
      if (hour === 7 && minute === 50 && lastMailKey !== mailKey) {
        lastMailKey = mailKey;
        await notifyTeachers(bot, '🔊 Коллеги, доброе утро! Просьба всем учителям отметить отсутствующих.');
      } else if ((hour === 8 && minute === 30) || (hour === 9 && minute === 0)) {
        if (lastMailKey !== mailKey) {
          lastMailKey = mailKey;
          const remaining = await notMarkedClasses();
          if (remaining.length) {
            const names = remaining.map((item) => item.className).join(', ');
            await notifyTeachers(
              bot,
              `Просьба всем учителям отметить отсутствующих.\nОсталось отметить: ${names}`,
            );
          }
        }
      }
    }

    if (weekday === 1 && hour === 4 && minute === 0 && lastCleanKey !== mailKey) {
      lastCleanKey = mailKey;
      await cleanAbsents();
      console.log('Weekly absents table cleaned');
    }
  }, 30_000);
}
