/**
 * Building blocks for Telegram messages in HTML parse mode. Every dynamic value must go through
 * `escapeHtml`, otherwise a file name containing `<`, `>` or `&` makes Telegram reject the message.
 */

export function escapeHtml(text: string): string {
	return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function bold(text: string): string {
	return `<b>${escapeHtml(text)}</b>`;
}

export function code(text: string): string {
	return `<code>${escapeHtml(text)}</code>`;
}

export function link(label: string, url: string): string {
	return `<a href="${escapeHtml(url).replaceAll('"', '&quot;')}">${escapeHtml(label)}</a>`;
}

export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return 'desconhecido';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	const value = bytes / 1024 ** exponent;
	return `${value.toFixed(exponent === 0 ? 0 : 2)} ${units[exponent]}`;
}

/** Failures listed individually in a summary; the rest is only counted, so the summary always fits one message. */
const MAX_LISTED_FAILURES = 15;

/** Shorten a name for a summary line, by code point so an emoji is never cut in half. */
export function truncate(text: string, maxLength = 80): string {
	const characters = Array.from(text);
	return characters.length <= maxLength ? text : `${characters.slice(0, maxLength - 1).join('')}…`;
}

/**
 * Bullet list of failures, capped so a summary with hundreds of failures stays readable and within Telegram's limit.
 * @param entries - Already escaped HTML, one per failure
 */
export function failureLines(entries: readonly string[]): string[] {
	const lines = entries.slice(0, MAX_LISTED_FAILURES).map((entry) => `• ${entry}`);
	if (entries.length > MAX_LISTED_FAILURES) lines.push(`… e mais ${entries.length - MAX_LISTED_FAILURES}.`);
	return lines;
}
