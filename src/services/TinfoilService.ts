import { UserFacingError } from '@/util/UserFacingError.ts';

export interface TinfoilOptions {
	updateUrl: string;
	/** `user:pass` pair; the integration is disabled when absent. */
	credentials?: string;
	fetch?: typeof fetch;
}

/** Asks the Tinfoil shop to rebuild its index from the Real-Debrid library. */
export class TinfoilService {
	private readonly fetch: typeof fetch;

	constructor(private readonly options: TinfoilOptions) {
		this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
	}

	/**
	 * Trigger the shop refresh. Credentials go in the `Authorization` header because
	 * Workers reject URLs with embedded credentials.
	 * @throws UserFacingError when the integration is not configured or the shop refuses the request
	 */
	async refresh(): Promise<void> {
		const { credentials, updateUrl } = this.options;
		if (!credentials) throw new UserFacingError('Integração com o Tinfoil não configurada (defina TINFOIL_USER_PASS).');

		const response = await this.fetch(updateUrl, {
			headers: { Authorization: `Basic ${btoa(credentials)}` },
			redirect: 'manual',
		});
		if (!response.ok) throw new UserFacingError(`O Tinfoil respondeu HTTP ${response.status}.`);
	}
}
