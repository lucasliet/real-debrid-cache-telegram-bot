import { Environment } from '@/config/environment.ts';
import { allowedExtensions } from '@/config/constants.ts';
import type { ResourceSchema, StreamingSchema, TorrentSchema, UnrestrictSchema } from '@/types/realdebrid.d.ts';

export class RealDebridService {
	private static instance: RealDebridService;
	private readonly API_URL = 'https://api.real-debrid.com/rest/1.0';
	private readonly rdToken: string;

	private constructor() {
		this.rdToken = Environment.getInstance().RD_TOKEN;
	}

	static getInstance(): RealDebridService {
		if (!RealDebridService.instance) {
			RealDebridService.instance = new RealDebridService();
		}
		return RealDebridService.instance;
	}

	async addTorrentFileWithStream(fileUrl: string): Promise<ResourceSchema> {
		// Baixar o arquivo do Telegram
		const fileResponse = await fetch(fileUrl, {
			headers: {
				'Accept': '*/*',
				'User-Agent': 'RealDebridTelegramBot/1.0',
			},
		});

		if (!fileResponse.ok) {
			throw new Error(
				`Erro ao baixar o arquivo do Telegram: ${fileResponse.status}`,
			);
		}

		const fileBuffer = await fileResponse.arrayBuffer();
		return this.addTorrentFile(fileBuffer);
	}

	private async addTorrentFile(
		fileBuffer: ArrayBuffer,
	): Promise<ResourceSchema> {
		const response = await fetch(
			`${this.API_URL}/torrents/addTorrent`,
			{
				method: 'PUT',
				headers: {
					'Authorization': `Bearer ${this.rdToken}`,
					'Content-Type': 'application/x-bittorrent',
				},
				body: fileBuffer,
			},
		);

		if (!response.ok) {
			throw new Error(`Erro ao adicionar torrent: ${response.status}`);
		}

		return await response.json();
	}

	async addMagnetLink(magnetUrl: string): Promise<ResourceSchema> {
		const formData = new FormData();
		formData.append('magnet', magnetUrl);

		const response = await fetch(
			`${this.API_URL}/torrents/addMagnet`,
			{
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${this.rdToken}`,
				},
				body: formData,
			},
		);

		if (!response.ok) {
			const error = await response.json();
			throw new Error(`Erro ao adicionar magnet: ${error.error}`);
		}

		return await response.json();
	}

	async getTorrentInfo(id: string): Promise<TorrentSchema> {
		const response = await fetch(
			`${this.API_URL}/torrents/info/${id}`,
			{
				headers: {
					'Authorization': `Bearer ${this.rdToken}`,
				},
			},
		);

		if (!response.ok) {
			const error = await response.json();
			throw new Error(`Erro ao obter informações do torrent: ${error.error}`);
		}

		return await response.json();
	}

	async selectTorrentFiles(id: string, fileIds: string[]): Promise<boolean> {
		const formData = new FormData();
		formData.append('files', fileIds.join(','));

		const response = await fetch(
			`${this.API_URL}/torrents/selectFiles/${id}`,
			{
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${this.rdToken}`,
				},
				body: formData,
			},
		);

		if (!response.ok) {
			const error = await response.json();
			throw new Error(`Erro ao selecionar arquivos: ${error.error}`);
		}

		return response.ok;
	}

	async listTorrents(): Promise<TorrentSchema[]> {
		const response = await fetch(
			`${this.API_URL}/torrents`,
			{
				headers: {
					'Authorization': `Bearer ${this.rdToken}`,
				},
			},
		);

		if (!response.ok) {
			const error = await response.json();
			throw new Error(`Erro ao listar torrents: ${error.error}`);
		}

		return await response.json();
	}

	async listDownloads(): Promise<UnrestrictSchema[]> {
		const response = await fetch(
			`${this.API_URL}/downloads`,
			{
				headers: {
					'Authorization': `Bearer ${this.rdToken}`,
				},
			},
		);

		if (!response.ok) {
			const error = await response.json();
			throw new Error(`Erro ao listar downloads: ${error.error}`);
		}

		return await response.json();
	}

	async deleteTorrent(id: string): Promise<boolean> {
		const response = await fetch(
			`${this.API_URL}/torrents/delete/${id}`,
			{
				method: 'DELETE',
				headers: {
					'Authorization': `Bearer ${this.rdToken}`,
				},
			},
		);

		if (!response.ok) {
			const error = await response.json();
			throw new Error(`Erro ao deletar torrent: ${error.error}`);
		}

		return response.ok;
	}

	async deleteDownload(id: string): Promise<boolean> {
		const response = await fetch(
			`${this.API_URL}/downloads/delete/${id}`,
			{
				method: 'DELETE',
				headers: {
					'Authorization': `Bearer ${this.rdToken}`,
				},
			},
		);

		if (!response.ok) {
			const error = await response.json();
			throw new Error(`Erro ao deletar download: ${error.error}`);
		}

		return response.ok;
	}

	async getTorrentLinks(id: string): Promise<string[]> {
		const torrentInfo = await this.getTorrentInfo(id);
		if (!torrentInfo.links || torrentInfo.links.length === 0) {
			throw new Error('Nenhum link disponível para este torrent');
		}
		return torrentInfo.links;
	}

	async unrestrictLink(link: string): Promise<UnrestrictSchema> {
		const formData = new FormData();
		formData.append('link', link);

		const response = await fetch(
			`${this.API_URL}/unrestrict/link`,
			{
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${this.rdToken}`,
				},
				body: formData,
			},
		);

		if (!response.ok) {
			const error = await response.json();
			throw new Error(`Erro ao desbloquear link: ${error.error}`);
		}

		return await response.json();
	}

	private normalizeString(str: string): string {
		return str.toLowerCase()
			.replace(/[._\-]/g, ' ') // substitui ponto, underline e traço por espaço
			.replace(/\s+/g, ' ') // substitui múltiplos espaços por um único
			.trim(); // remove espaços do início e fim
	}

	private searchByNormalizedQuery<T extends { filename: string }>(
		items: T[],
		query: string,
	): T[] {
		const normalizedQuery = this.normalizeString(query);
		return items.filter((item) => this.normalizeString(item.filename).includes(normalizedQuery));
	}

	async searchTorrents(query: string): Promise<TorrentSchema[]> {
		const torrents = await this.listTorrents();
		return this.searchByNormalizedQuery(torrents, query);
	}

	async searchDownloads(query: string): Promise<UnrestrictSchema[]> {
		const downloads = await this.listDownloads();
		return this.searchByNormalizedQuery(downloads, query);
	}

	async searchByFileName(
		query: string,
	): Promise<{ torrents: TorrentSchema[]; downloads: UnrestrictSchema[] }> {
		const [torrents, downloads] = await Promise.all([
			this.searchTorrents(query),
			this.searchDownloads(query),
		]);
		console.log(`Encontrados ${torrents.length} torrents e ${downloads.length} downloads com "${query}" no nome.`);
		return { torrents, downloads };
	}

	async cleanByName(
		query: string,
	): Promise<{ deleted: number; errors: string[] }> {
		const result = {
			deleted: 0,
			errors: [] as string[],
		};

		try {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			const torrentsToDelete = await this.searchTorrents(query);
			console.log(`Encontrados ${torrentsToDelete.length} torrents com "${query}" no nome.`);
			for (const torrent of torrentsToDelete) {
				try {
					console.log(`Deletando torrent ${torrent.id} (${torrent.filename})...`);
					await new Promise((resolve) => setTimeout(resolve, 1000));
					await this.deleteTorrent(torrent.id);
					result.deleted++;
				} catch (error) {
					result.errors.push(
						`Erro ao deletar torrent ${torrent.id} (${torrent.filename}): ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
					);
				}
			}
		} catch (error) {
			result.errors.push(
				`Erro ao buscar torrents: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
			);
		}

		return result;
	}

	async getStreamingInfo(id: string): Promise<StreamingSchema> {
		const response = await fetch(
			`${this.API_URL}/streaming/transcode/${id}`,
			{
				headers: {
					'Authorization': `Bearer ${this.rdToken}`,
				},
			},
		);

		if (!response.ok) {
			const error = await response.json();
			throw new Error(`Erro ao obter informações de streaming: ${error.error}`);
		}

		return await response.json();
	}

	async deleteSwitchTorrents(): Promise<
		{ deleted: number; errors: string[] }
	> {
		const torrents = await this.listTorrents();
		const result = {
			deleted: 0,
			errors: [] as string[],
		};

		for (const torrent of torrents) {
			try {
				console.log(`Verificando torrent ${torrent.id} (${torrent.filename})...`);
				await new Promise((resolve) => setTimeout(resolve, 1000));
				const info = await this.getTorrentInfo(torrent.id);

				if (info.files) {
					const fileExtensions = info.files.map((file) => file.path.split('.').pop()?.toLowerCase());

					if (allowedExtensions.some((ext) => fileExtensions?.includes(ext))) {
						console.log(`Deletando torrent ${torrent.id} (${torrent.filename})`);
						await new Promise((resolve) => setTimeout(resolve, 1000));
						await this.deleteTorrent(torrent.id);
						result.deleted++;
					}
				}
			} catch (error) {
				result.errors.push(
					`Erro ao processar torrent ${torrent.id}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
				);
			}
		}

		return result;
	}
}
