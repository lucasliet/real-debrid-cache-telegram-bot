import { Context, SessionFlavor } from 'grammy';

export interface SessionData {
	uploads: {
		id: string;
		filename: string;
		status: string;
	}[];
}

export type MyContext = Context & SessionFlavor<SessionData>;
