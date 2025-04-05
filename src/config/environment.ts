export class Environment {
  private static instance: Environment;
  private env: Record<string, string> = {};

  private constructor() {
    this.loadEnvironmentSync();
  }

  static getInstance(): Environment {
    if (!Environment.instance) {
      Environment.instance = new Environment();
    }
    return Environment.instance;
  }

  private loadEnvironmentSync() {
    try {
      const envPath = new URL('../../.env', import.meta.url);
      const envContent = Deno.readTextFileSync(envPath);
      
      const envLines = envContent.split('\n');
      for (const line of envLines) {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').trim();
          this.env[key.trim()] = value;
        }
      }
      
      console.log("Variáveis de ambiente carregadas com sucesso!");
    } catch (e) {
      console.error("Erro ao carregar .env:", e instanceof Error ? e.message : e);
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

  get TINFOIL_USER_PASS(): string {
    return this.env["TINFOIL_USER_PASS"] || Deno.env.get("TINFOIL_USER_PASS") || "";
  }
}
