import { load } from "std/dotenv";

export class Environment {
  private static instance: Environment;
  private env: Record<string, string> = {};

  private constructor() {
    this.loadEnvironment();
  }

  static getInstance(): Environment {
    if (!Environment.instance) {
      Environment.instance = new Environment();
    }
    return Environment.instance;
  }

  private async loadEnvironment() {
    try {
      this.env = await load();
    } catch (_e) {
      console.log("Executando sem arquivo .env, usando variáveis de ambiente do sistema");
    }
  }

  get BOT_TOKEN(): string {
    return this.env["BOT_TOKEN"] || Deno.env.get("BOT_TOKEN") || "";
  }

  get RD_TOKEN(): string {
    return this.env["RD_TOKEN"] || Deno.env.get("RD_TOKEN") || "";
  }

  get ALLOWED_USER_ID(): number {
    const allowedUser = this.env["ALLOWED_USER_ID"] || Deno.env.get("ALLOWED_USER_ID");
    return Number(allowedUser || 0);
  }
}
