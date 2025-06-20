import jwt from 'jsonwebtoken';
import { config } from './config.js';

export interface AuthContext {
  userId?: string;
  apiKey?: string;
  authenticated: boolean;
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export function validateApiKey(apiKey: string): boolean {
  if (!config.API_KEY) {
    return false;
  }
  return apiKey === config.API_KEY;
}

export function generateJWT(userId: string): string {
  return jwt.sign({ userId }, config.JWT_SECRET, { 
    expiresIn: '24h',
    issuer: 'mcp-postgres-server'
  });
}

export function verifyJWT(token: string): { userId: string } {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as { userId: string };
    return decoded;
  } catch (error) {
    throw new AuthenticationError('Invalid JWT token');
  }
}

export function authenticateRequest(authHeader?: string): AuthContext {
  if (!authHeader) {
    return { authenticated: false };
  }

  // Check for Bearer token (JWT)
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const { userId } = verifyJWT(token);
      return { userId, authenticated: true };
    } catch (error) {
      throw new AuthenticationError('Invalid bearer token');
    }
  }

  // Check for API key
  if (authHeader.startsWith('ApiKey ')) {
    const apiKey = authHeader.substring(7);
    if (validateApiKey(apiKey)) {
      return { apiKey, authenticated: true };
    } else {
      throw new AuthenticationError('Invalid API key');
    }
  }

  throw new AuthenticationError('Invalid authentication format');
}

// OAuth 2.1 support for Claude web interface
export interface OAuthTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token?: string;
}

export function generateOAuthToken(userId: string): OAuthTokenResponse {
  const access_token = generateJWT(userId);
  
  return {
    access_token,
    token_type: 'Bearer',
    expires_in: 86400, // 24 hours
  };
}