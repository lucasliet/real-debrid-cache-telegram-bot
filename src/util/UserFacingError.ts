/** Expected failure whose message (in Portuguese) is safe and meaningful to show to the user as is. */
export class UserFacingError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'UserFacingError';
	}
}
