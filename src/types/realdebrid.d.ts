type TorrentFile = {
	id: number;
	path: string;
	bytes: number;
	selected: 0 | 1;
};

type TorrentStatus =
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

interface TorrentSchema {
	id: string;
	filename: string;
	original_filename: string;
	hash: string;
	bytes: number;
	original_bytes: number;
	host: string;
	split: number;
	progress: number;
	status: TorrentStatus;
	added: string;
	files: TorrentFile[];
	links: string[];
	ended?: string;
	speed?: number;
	seeders?: number;
}

interface ResourceSchema {
	id: string;
	uri: string;
}

interface StreamQualityMap {
	[quality: string]: string;
}

interface StreamingSchema {
	apple: StreamQualityMap; // M3U8 Live Streaming format
	dash: StreamQualityMap; // MPD Live Streaming format
	liveMP4: StreamQualityMap; // Live MP4
	h264WebM: StreamQualityMap; // Live H264 WebM
}

export interface UnrestrictSchema {
	id: string;
	filename: string;
	mimeType: string;
	filesize: number;
	link: string;
	host: string;
	chunks: number;
	crc: number;
	download: string;
	streamable: number;
}
