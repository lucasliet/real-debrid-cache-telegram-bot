/** File extensions of Nintendo Switch ROMs, which are added to Real-Debrid one torrent per file. */
export const SWITCH_ROM_EXTENSIONS: ReadonlySet<string> = new Set(['nsp', 'nsz', 'xci', 'xcz']);

/** Maximum length of a Telegram text message. */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

/** Entries per page of a listing: with full names they fit one message, within Telegram's 100-entity limit. */
export const LISTING_PAGE_SIZE = 10;
