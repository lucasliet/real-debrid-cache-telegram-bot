import { assert } from 'vitest';

/**
 * Assert that the function rejects with an instance of the given class and return the error for further checks.
 * @param run - Function expected to reject
 * @param errorClass - Expected error class
 * @param messageIncludes - Text the error message must contain
 */
export async function rejects<E extends Error>(
	run: () => Promise<unknown>,
	// biome-ignore lint/suspicious/noExplicitAny: constructors of error classes take arbitrary arguments
	errorClass: new (...args: any[]) => E,
	messageIncludes?: string,
): Promise<E> {
	let error: unknown;
	try {
		await run();
	} catch (caught) {
		error = caught;
	}
	assert.instanceOf(error, errorClass, 'expected the call to reject');
	if (messageIncludes) assert.include((error as E).message, messageIncludes);
	return error as E;
}
