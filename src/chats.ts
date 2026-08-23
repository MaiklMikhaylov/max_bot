import type { Api } from '@maxhub/max-bot-api';

const cache = new Map<string, number>();

export async function findChatIdByTitle(api: Api, title: string): Promise<number | null> {
  const cached = cache.get(title);
  if (cached) return cached;

  const wanted = title.trim().toLowerCase();
  const seen: string[] = [];
  let marker: number | null | undefined;

  do {
    const response = await api.getAllChats(marker ? { marker } : undefined);
    for (const item of response.chats) {
      const chatTitle = (item.title ?? '').trim();
      if (chatTitle) seen.push(chatTitle);
      if (chatTitle.toLowerCase() === wanted) {
        cache.set(title, item.chat_id);
        return item.chat_id;
      }
    }
    marker = response.marker;
  } while (marker);

  if (seen.length) {
    console.warn(`Available chats: ${seen.join(' | ')}`);
  } else {
    console.warn('Bot is not in any chats yet.');
  }

  return null;
}

export function resetChatCache(title?: string): void {
  if (title) cache.delete(title);
  else cache.clear();
}
