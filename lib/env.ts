const REQUIRED_ENV_VARS = ["YELP_API_KEY", "GOOGLE_MAPS_API_KEY"] as const;

type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];

export type ServerEnv = Record<RequiredEnvVar, string>;

export class EnvValidationError extends Error {
  constructor(missingKeys: string[]) {
    super(
      `Missing required server environment variables: ${missingKeys.join(", ")}. ` +
        "Copy .env.example to .env.local and fill in each value.",
    );
    this.name = "EnvValidationError";
  }
}

export function getServerEnv(): ServerEnv {
  const missingKeys = REQUIRED_ENV_VARS.filter((key) => {
    const value = process.env[key];
    return !value || value.trim().length === 0;
  });

  if (missingKeys.length > 0) {
    throw new EnvValidationError(missingKeys);
  }

  return {
    YELP_API_KEY: process.env.YELP_API_KEY as string,
    GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY as string,
  };
}
