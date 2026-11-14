import { createHmac } from 'node:crypto';

export function searchWords(text: string) {
  return [
    ...new Set(
      text
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[đĐ]/g, 'd')
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? [],
    ),
  ];
}
// Keep the oldest encryption key while this index exists. Domain separation
// prevents search hashes from being used as message encryption keys.
export function searchTokens(text: string) {
  const entries = (process.env.MESSAGE_ENCRYPTION_KEYS ?? '')
    .split(',')
    .filter(Boolean)
    .sort((a, b) => Number(a.split(':')[0]) - Number(b.split(':')[0]));
  const key = entries[0]?.split(':')[1];
  if (!key && process.env.NODE_ENV !== 'test')
    throw new Error('Search encryption key unavailable');
  return searchWords(text).map((word) =>
    createHmac('sha256', key ? Buffer.from(key, 'hex') : Buffer.alloc(32))
      .update(`message-search:v1:${word}`)
      .digest('hex'),
  );
}
