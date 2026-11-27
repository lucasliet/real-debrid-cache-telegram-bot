/**
 * Shapes returned by the Real-Debrid REST API v1.0 (https://api.real-debrid.com/).
 */

export type TorrentStatus =
	| 'magnet_error'
	| 'magnet_conversion'
	| 'waiting_files_selection'
	| 'queued'
	| 'downloading'
	| 'downloaded'
	| 'error'
	| 'virus'
	| 'compressing'
	| 'uploading'
	| 'dead';

/** Statuses a torrent never leaves, so waiting on them is pointless. */
export const FAILED_TORRENT_STATUSES: ReadonlySet<TorrentStatus> = new Set(['magnet_error', 'error', 'virus', 'dead']);

export interface TorrentFile {
	id: number;
	/** Path inside the torrent, starting with "/". */
	path: string;
	bytes: number;
	selected: 0 | 1;
}

/** Entry of `GET /torrents`. */
export interface Torrent {
	id: string;
	filename: string;
	/** SHA1 hash of the torrent. */
	hash: string;
	/** Size of the selected files only. */
	bytes: number;
	host: string;
	split: number;
	/** 0 to 100. */
	progress: number;
	status: TorrentStatus;
	added: string;
	links: string[];
	/** Only present when finished. */
	ended?: string;
	/** Bytes per second; only present while downloading, compressing or uploading. */
	speed?: number;
	/** Only present while downloading or converting the magnet. */
	seeders?: number;
}

/** Response of `GET /torrents/info/{id}`. */
export interface TorrentInfo extends Torrent {
	original_filename: string;
	original_bytes: number;
	files: TorrentFile[];
}

/** Response of `PUT /torrents/addTorrent` and `POST /torrents/addMagnet`. */
export interface CreatedResource {
	id: string;
	uri: string;
}

/** Entry of `GET /downloads`. */
export interface Download {
	id: string;
	filename: string;
	mimeType: string;
	/** Bytes, 0 if unknown. */
	filesize: number;
	/** Original hoster link. */
	link: string;
	host: string;
	chunks: number;
	/** Generated (unrestricted) link. */
	download: string;
	generated: string;
	/** Not part of the documented schema, but returned by the API alongside the other fields. */
	streamable?: 0 | 1;
}

/** Response of `POST /unrestrict/link`. */
export interface UnrestrictedLink {
	id: string;
	filename: string;
	mimeType: string;
	filesize: number;
	link: string;
	host: string;
	chunks: number;
	crc: number;
	download: string;
	streamable: 0 | 1;
}

/** Quality label mapped to its stream URL. */
export type StreamQualityMap = Record<string, string>;

/** Response of `GET /streaming/transcode/{id}`. */
export interface TranscodeLinks {
	/** M3U8 live streaming. */
	apple?: StreamQualityMap;
	/** MPD live streaming. */
	dash?: StreamQualityMap;
	liveMP4?: StreamQualityMap;
	h264WebM?: StreamQualityMap;
}

/** Response of `GET /user`. */
export interface User {
	id: number;
	username: string;
	email: string;
	/** Fidelity points. */
	points: number;
	locale: string;
	avatar: string;
	type: 'premium' | 'free';
	/** Seconds left as a premium user. */
	premium: number;
	expiration: string;
}

/** Response of `GET /torrents/activeCount`. */
export interface ActiveTorrentCount {
	/** Currently active torrents. */
	nb: number;
	/** Maximum simultaneous active torrents. */
	limit: number;
}

/** One page of a paginated listing, with the grand total reported by `X-Total-Count`. */
export interface Page<T> {
	items: T[];
	total: number;
}
