/**
 * @param path - File path or name
 * @returns Lowercase extension without the dot, or an empty string when there is none
 */
export function fileExtension(path: string): string {
	const name = fileName(path);
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * @param path - Path using "/" separators
 * @returns Last segment of the path
 */
export function fileName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}
