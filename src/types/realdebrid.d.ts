type TorrentFile = {
    id: number;
    path: string;
    bytes: number;
    selected: 0 | 1;
};

type TorrentStatus =
    'magnet_error' |
    'magnet_conversion' |
    'waiting_files_selection' |
    'queued' |
    'downloading' |
    'downloaded' |
    'error' |
    'virus' |
    'compressing' |
    'uploading' |
    'dead';

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