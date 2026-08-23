import type { Context } from '@maxhub/max-bot-api';
import { FileAttachment, ImageAttachment } from '@maxhub/max-bot-api';
import { mainMenuKeyboard, withPersistentStart } from './keyboards.js';
import { getEmployeeByUserId, getEmployeeRoles } from './storage.js';

export function getUserId(ctx: Context): number | undefined {
  return ctx.user?.user_id;
}

export function getMessageText(ctx: Context): string | undefined {
  return ctx.message?.body.text?.trim() || undefined;
}

export function getPhotoToken(ctx: Context): string | undefined {
  const attachments = ctx.message?.body.attachments ?? [];
  const image = attachments.find((item) => item.type === 'image');
  if (image && image.type === 'image') return image.payload.token;
  return undefined;
}

export function prettyUsername(username?: string | null): string {
  return username ? `@${username}` : 'Не известен';
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Кликабельное упоминание профиля MAX.
 * Текст ссылки ДОЛЖЕН совпадать с именем из профиля MAX (ctx.user.name), иначе ссылка неактивна.
 */
export function profileMentionHtml(userId: number, maxProfileName: string): string {
  const name = escapeHtml(maxProfileName.trim() || 'Пользователь');
  return `<a href="max://user/${userId}">${name}</a>`;
}

export async function ack(ctx: Context, notification?: string): Promise<void> {
  try {
    await ctx.answerOnCallback(notification ? { notification } : {});
  } catch {
    // callback may already be answered
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendFileWithRetry(
  send: () => Promise<unknown>,
  label: string,
): Promise<boolean> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await send();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${label} (attempt ${attempt}):`, error);
      if (attempt < 5 && /not ready|attachment/i.test(message)) {
        await sleep(1500 * attempt);
        continue;
      }
      if (attempt < 5) await sleep(1000 * attempt);
    }
  }
  return false;
}

/** Любой ответ пользователю: «Старт» всегда на этом (последнем) сообщении. */
export async function sendHtml(
  ctx: Context,
  text: string,
  attachments?: unknown[],
): Promise<void> {
  await ctx.reply(text, {
    format: 'html',
    attachments: withPersistentStart(attachments) as never,
  });
}

/**
 * Интерактивные сценарии: то же правило — «Старт» на актуальном сообщении.
 */
export async function sendInteractiveHtml(
  ctx: Context,
  text: string,
  attachments?: unknown[],
): Promise<void> {
  await ctx.reply(text, {
    format: 'html',
    attachments: withPersistentStart(attachments) as never,
  });
}

/** Заменить содержимое текущего сообщения; «Старт» остаётся на нём (оно же «последнее» в сценарии). */
export async function replaceHtml(
  ctx: Context,
  text: string,
  attachments?: unknown[],
  notification?: string,
): Promise<void> {
  const payload = {
    text,
    format: 'html' as const,
    attachments: withPersistentStart(attachments) as never,
  };

  if (ctx.updateType === 'message_callback') {
    try {
      await ctx.answerOnCallback({
        notification,
        message: payload,
      });
      return;
    } catch (error) {
      console.warn('answerOnCallback(message) failed, trying editMessage:', error);
      try {
        await ctx.editMessage(payload);
        await ack(ctx, notification);
        return;
      } catch (editError) {
        console.warn('editMessage failed, sending new interactive message:', editError);
      }
    }
  }

  await ack(ctx, notification);
  await sendInteractiveHtml(ctx, text, attachments);
}

export function imageAttachment(token: string) {
  return new ImageAttachment({ token }).toJson();
}

export function fileAttachment(token: string) {
  return new FileAttachment({ token }).toJson();
}

export async function sendMainMenu(ctx: Context, userId: number, text = 'Вы в главном меню'): Promise<void> {
  const employee = await getEmployeeByUserId(userId);
  if (!employee) {
    await sendHtml(ctx, text);
    return;
  }
  const roles = await getEmployeeRoles(employee.employeeId);
  await sendHtml(ctx, text, [mainMenuKeyboard(roles)]);
}
