import { Environment } from '@/config/environment.ts';
import type {
	ResourceSchema,
	StreamingSchema,
	TorrentSchema,
	UnrestrictSchema,
} from '@/types/realdebrid.d.ts';

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

	async searchByFileName(
		query: string,
	): Promise<{ torrents: TorrentSchema[]; downloads: UnrestrictSchema[] }> {
		const [torrents, downloads] = await Promise.all([
			this.listTorrents(),
			this.listDownloads(),
		]);

		const normalizeString = (str: string): string => {
			return str.toLowerCase()
				.replace(/[._\-]/g, ' ') // substitui ponto, underline e traço por espaço
				.replace(/\s+/g, ' ') // substitui múltiplos espaços por um único
				.trim(); // remove espaços do início e fim
		};

		const normalizedQuery = normalizeString(query);

		const filteredTorrents = torrents.filter((t) =>
			normalizeString(t.filename).includes(normalizedQuery)
		);

		const filteredDownloads = downloads.filter((d) =>
			normalizeString(d.filename).includes(normalizedQuery)
		);

		return {
			torrents: filteredTorrents,
			downloads: filteredDownloads,
		};
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
}
