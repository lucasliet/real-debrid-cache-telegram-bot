/**
 * Numeric `error_code` values documented at https://api.real-debrid.com/#api_error_codes,
 * translated into user-facing messages.
 */
const ERROR_MESSAGES: Readonly<Record<number, string>> = {
	[-1]: 'Erro interno do Real-Debrid',
	1: 'Parâmetro obrigatório ausente',
	2: 'Valor de parâmetro inválido',
	3: 'Método desconhecido',
	4: 'Método não permitido',
	5: 'Muitas requisições, aguarde um instante',
	6: 'Recurso inacessível',
	7: 'Recurso não encontrado',
	8: 'Token do Real-Debrid inválido ou expirado',
	9: 'Permissão negada',
	10: 'Autenticação em dois fatores necessária',
	11: 'Autenticação em dois fatores pendente',
	12: 'Login inválido',
	13: 'Senha inválida',
	14: 'Conta bloqueada',
	15: 'Conta não ativada',
	16: 'Hoster não suportado',
	17: 'Hoster em manutenção',
	18: 'Limite do hoster atingido',
	19: 'Hoster temporariamente indisponível',
	20: 'Hoster indisponível para contas gratuitas',
	21: 'Muitos downloads ativos',
	22: 'Endereço IP não permitido',
	23: 'Tráfego esgotado',
	24: 'Arquivo indisponível',
	25: 'Serviço indisponível',
	26: 'Upload grande demais',
	27: 'Erro no upload',
	28: 'Arquivo não permitido',
	29: 'Torrent grande demais',
	30: 'Arquivo torrent inválido',
	31: 'Ação já realizada',
	32: 'Resolução de imagem inválida',
	33: 'Torrent já está ativo',
	34: 'Muitas requisições, aguarde um instante',
	35: 'Arquivo removido por infração de direitos autorais',
	36: 'Limite de uso justo atingido',
	37: 'Endpoint desativado pelo Real-Debrid',
};

/** `error_code` values that mean "slow down" rather than a definitive failure. */
const RATE_LIMIT_CODES: ReadonlySet<number> = new Set([5, 34]);

/** Failure reported by the Real-Debrid API. */
export class RealDebridError extends Error {
	/**
	 * @param status - HTTP status of the response
	 * @param code - Numeric `error_code` from the body, when present
	 * @param apiMessage - Raw `error` string from the body, when present
	 */
	constructor(
		readonly status: number,
		readonly code?: number,
		readonly apiMessage?: string,
	) {
		super(RealDebridError.describe(status, code, apiMessage));
		this.name = 'RealDebridError';
	}

	/** Whether the request was refused for exceeding the rate limit and may be retried later. */
	get isRateLimited(): boolean {
		return this.status === 429 || (this.code !== undefined && RATE_LIMIT_CODES.has(this.code));
	}

	private static describe(status: number, code?: number, apiMessage?: string): string {
		const known = code === undefined ? undefined : ERROR_MESSAGES[code];
		if (known) return known;
		if (apiMessage) return `Real-Debrid: ${apiMessage}`;
		return `Real-Debrid respondeu HTTP ${status}`;
	}
}
