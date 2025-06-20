import { z } from 'zod';

const configSchema = z.object({
  // Database configuration (RDS PostgreSQL)
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(5432),
  DB_NAME: z.string().default('testdb'),
  DB_USER: z.string().default('testuser'),
  DB_PASSWORD: z.string().default('testpass'),
  
  // Server configuration (EC2)
  SERVER_PORT: z.coerce.number().default(3000),
  SERVER_HOST: z.string().default('0.0.0.0'), // Listen on all interfaces for EC2
  
  // Authentication configuration
  JWT_SECRET: z.string().min(32),
  API_KEY: z.string().optional(),
  
  // OAuth 2.1 configuration (for Claude web interface)
  OAUTH_CLIENT_ID: z.string().optional(),
  OAUTH_CLIENT_SECRET: z.string().optional(),
  OAUTH_REDIRECT_URI: z.string().optional(),
  
  // Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const env = {
    DB_HOST: process.env.DB_HOST,
    DB_PORT: process.env.DB_PORT,
    DB_NAME: process.env.DB_NAME,
    DB_USER: process.env.DB_USER,
    DB_PASSWORD: process.env.DB_PASSWORD,
    SERVER_PORT: process.env.SERVER_PORT,
    SERVER_HOST: process.env.SERVER_HOST,
    JWT_SECRET: process.env.JWT_SECRET,
    API_KEY: process.env.API_KEY,
    OAUTH_CLIENT_ID: process.env.OAUTH_CLIENT_ID,
    OAUTH_CLIENT_SECRET: process.env.OAUTH_CLIENT_SECRET,
    OAUTH_REDIRECT_URI: process.env.OAUTH_REDIRECT_URI,
    NODE_ENV: process.env.NODE_ENV,
  };

  try {
    return configSchema.parse(env);
  } catch (error) {
    console.error('Configuration validation failed:', error);
    process.exit(1);
  }
}

export const config = loadConfig();