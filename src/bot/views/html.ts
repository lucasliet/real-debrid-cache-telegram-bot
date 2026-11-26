/**
 * Building blocks for Telegram messages in HTML parse mode. Every dynamic value must go through
 * `escapeHtml`, otherwise a file name containing `<`, `>` or `&` makes Telegram reject the message.
 */

const SEPARATOR = '──────────────';

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

/**
 * Link that fills the chat input with a command when tapped, working as an inline action button.
 * The label is padded to make the tap target larger.
 */
export function commandLink(label: string, command: string): string {
	return link(`   ${label}   `, `tg://msg?text=${encodeURIComponent(command)}`);
}

/** Row of action links framed by separators, visually detached from the entry text. */
export function actionRow(...actions: string[]): string {
	return `${SEPARATOR}\n${actions.join(' ')}\n${SEPARATOR}`;
}

export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return 'desconhecido';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	const value = bytes / 1024 ** exponent;
	return `${value.toFixed(exponent === 0 ? 0 : 2)} ${units[exponent]}`;
}
