/**
 * Caches the value built for one key at a time: asking for another key replaces it, and a failed build
 * is not kept, so the next request tries again.
 */
export class SingleValueCache<T> {
	private entry?: { key: string; value: Promise<T> };

	/**
	 * @param key - Identifies what the value was built from
	 * @param build - Builds the value when the key differs from the cached one
	 * @returns The cached value for the key, building it when needed
	 */
	get(key: string, build: () => Promise<T>): Promise<T> {
		if (this.entry?.key === key) return this.entry.value;

		const entry = {
			key,
			value: build().catch((error) => {
				if (this.entry === entry) this.entry = undefined;
				throw error;
			}),
		};
		this.entry = entry;
		return entry.value;
	}
}
