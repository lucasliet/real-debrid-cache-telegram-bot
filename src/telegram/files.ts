import type { Api } from 'grammy';
import { UserFacingError } from '@/util/UserFacingError.ts';

/** Bots can only download files up to 20 MB (https://core.telegram.org/bots/api#getfile). */
const MAX_DOWNLOADABLE_BYTES = 20 * 1024 * 1024;

export interface TelegramDocument {
	file_id: string;
	file_size?: number;
}

/**
 * Download a file the user sent to the bot.
 * @param api - Bot API client
 * @param botToken - Token used to build the file URL
 * @param document - Document attached to the message
 * @param fetchFile - Fetch implementation (injectable for tests)
 * @returns File content
 * @throws UserFacingError when the file is too large or cannot be downloaded
 */
export async function downloadTelegramFile(api: Api, botToken: string, document: TelegramDocument, fetchFile: typeof fetch = fetch): Promise<ArrayBuffer> {
	if ((document.file_size ?? 0) > MAX_DOWNLOADABLE_BYTES) {
		throw new UserFacingError('Arquivo grande demais: o Telegram só permite que bots baixem arquivos de até 20 MB.');
	}

	const { file_path: filePath } = await api.getFile(document.file_id);
	if (!filePath) throw new UserFacingError('O Telegram não disponibilizou o arquivo para download.');

	let response: Response;
	try {
		response = await fetchFile(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
	} catch {
		// The cause is dropped on purpose: network errors may quote the URL, which embeds the bot token.
		throw new UserFacingError('Não foi possível baixar o arquivo do Telegram (falha de rede).');
	}
	if (!response.ok) throw new UserFacingError(`Não foi possível baixar o arquivo do Telegram (HTTP ${response.status}).`);
	return response.arrayBuffer();
}
