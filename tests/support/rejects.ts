import { assert } from 'vitest';

/**
 * Assert that the function rejects with an instance of the given class and return the error for further checks.
 * @param run - Function expected to reject
 * @param errorClass - Expected error class
 * @param messageIncludes - Text the error message must contain
 */
export async function rejects<E extends Error>(
	run: () => Promise<unknown>,
	errorClass: abstract new (...args: never[]) => E,
	messageIncludes?: string,
): Promise<E> {
	let error: unknown;
	try {
		await run();
	} catch (caught) {
		error = caught;
	}
	if (!(error instanceof errorClass)) {
		assert.fail(`expected the call to reject with ${errorClass.name}, got ${String(error)}`);
	}
	if (messageIncludes) assert.include(error.message, messageIncludes);
	return error;
}
