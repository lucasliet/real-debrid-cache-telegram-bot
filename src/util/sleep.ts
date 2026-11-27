/** Function that resolves after the given delay; injectable so tests never wait for real time. */
export type Sleep = (milliseconds: number) => Promise<void>;

export const sleep: Sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
