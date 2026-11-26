import { SWITCH_ROM_EXTENSIONS } from '@/config/constants.ts';
import { bold, escapeHtml } from '@/bot/views/html.ts';

interface CommandSpec {
	readonly command: string;
	/** Argument placeholder shown in the help, e.g. `<id>`. */
	readonly argument?: string;
	readonly description: string;
}

/** Single source of truth for the commands: feeds the help message and the Telegram command menu. */
export const COMMANDS: readonly CommandSpec[] = [
	{ command: 'ajuda', description: 'Mostra as instruções de uso' },
	{ command: 'conta', description: 'Mostra plano, validade e torrents ativos da conta' },
	{ command: 'status_torrent', description: 'Lista os torrents mais recentes' },
	{ command: 'status_download', description: 'Lista os downloads mais recentes' },
	{ command: 'incomplete', description: 'Lista os torrents que ainda não terminaram' },
	{ command: 'download', argument: '<id>', description: 'Gera os links diretos de um torrent baixado' },
	{ command: 'stream', argument: '<id>', description: 'Mostra os links de streaming de um download' },
	{ command: 'unrestrict', argument: '<link>', description: 'Gera o link direto de um link de hoster' },
	{ command: 'delete_torrent', argument: '<id>', description: 'Remove um torrent' },
	{ command: 'delete_download', argument: '<id>', description: 'Remove um download' },
	{ command: 'clean_by', argument: '<termo>', description: 'Remove todos os torrents com o termo no nome' },
	{ command: 'clean_nsw', description: 'Remove todos os torrents de jogos de Nintendo Switch' },
	{ command: 'update_tinfoil', description: 'Atualiza o índice da loja Tinfoil' },
];

/** Payload for Telegram's `setMyCommands`. */
export function commandMenu(): { command: string; description: string }[] {
	return COMMANDS.map(({ command, description }) => ({ command, description }));
}

const ROM_EXTENSIONS = [...SWITCH_ROM_EXTENSIONS].join(', ');

export function welcomeMessage(): string {
	return [
		bold('Bem-vindo ao Real-Debrid Cache Bot! 🚀'),
		'',
		'Envie um arquivo .torrent ou um link magnet para adicioná-lo ao Real-Debrid.',
		`ROMs de Nintendo Switch (${ROM_EXTENSIONS}) são adicionadas um arquivo por torrent, evitando arquivos RAR.`,
		'',
		'Use /ajuda para ver todos os comandos.',
	].join('\n');
}

export function helpMessage(): string {
	return [
		bold('📖 Instruções de uso'),
		'',
		'• Envie um arquivo .torrent ou um link magnet para adicioná-lo',
		`• Torrents só com ROMs de Switch (${ROM_EXTENSIONS}) viram um torrent por arquivo; os demais são adicionados com todos os arquivos`,
		'• Envie qualquer texto para buscar torrents e downloads pelo nome',
		'',
		bold('📋 Comandos'),
		...COMMANDS.map(({ command, argument, description }) => `• /${command}${argument ? ` ${escapeHtml(argument)}` : ''} — ${escapeHtml(description)}`),
	].join('\n');
}
