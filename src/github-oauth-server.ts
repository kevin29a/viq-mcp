import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { generateJWT } from './auth.js';

const app = express();

app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// GitHub OAuth configuration
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GITHUB_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI || 'http://localhost:3000/auth/callback';

interface GitHubUser {
  id: number;
  login: string;
  name: string;
  email: string;
  avatar_url: string;
}

// OAuth 2.0 Authorization Code Flow - Step 1: Redirect to GitHub
app.get('/auth/github', (req, res) => {
  const state = Math.random().toString(36).substring(2, 15);
  const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
  
  githubAuthUrl.searchParams.append('client_id', GITHUB_CLIENT_ID || '');
  githubAuthUrl.searchParams.append('redirect_uri', GITHUB_REDIRECT_URI);
  githubAuthUrl.searchParams.append('scope', 'user:email');
  githubAuthUrl.searchParams.append('state', state);
  
  // In production, store state in session/cookie for validation
  res.cookie('oauth_state', state, { httpOnly: true, maxAge: 600000 }); // 10 minutes
  
  res.redirect(githubAuthUrl.toString());
});

// OAuth 2.0 Authorization Code Flow - Step 2: Handle callback from GitHub
app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  const storedState = req.cookies?.oauth_state;
  
  // Validate state parameter to prevent CSRF attacks
  if (!state || state !== storedState) {
    return res.status(400).json({
      error: 'invalid_state',
      message: 'Invalid state parameter'
    });
  }
  
  if (!code) {
    return res.status(400).json({
      error: 'missing_code',
      message: 'Authorization code not provided'
    });
  }
  
  try {
    // Exchange authorization code for access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code: code as string,
        redirect_uri: GITHUB_REDIRECT_URI,
      }),
    });
    
    const tokenData = await tokenResponse.json();
    
    if (tokenData.error) {
      return res.status(400).json({
        error: tokenData.error,
        message: tokenData.error_description || 'Failed to exchange code for token'
      });
    }
    
    const accessToken = tokenData.access_token;
    
    // Get user information from GitHub
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });
    
    const userData: GitHubUser = await userResponse.json();
    
    // Generate our own JWT token for the MCP server
    const jwtToken = generateJWT(userData.login);
    
    // Clear state cookie
    res.clearCookie('oauth_state');
    
    // Return success page with token (in production, you'd handle this more securely)
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Authentication Successful</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
          .success { color: #28a745; }
          .token { background: #f8f9fa; padding: 15px; border-radius: 5px; font-family: monospace; word-break: break-all; }
        </style>
      </head>
      <body>
        <h1 class="success">✅ Authentication Successful!</h1>
        <p>Welcome, <strong>${userData.name || userData.login}</strong>!</p>
        <p>Your JWT token for the MCP server:</p>
        <div class="token">${jwtToken}</div>
        <p><small>Save this token to authenticate with the MCP server. In Claude, you can use it in the Authorization header.</small></p>
      </body>
      </html>
    `);
    
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).json({
      error: 'server_error',
      message: 'Internal server error during authentication'
    });
  }
});

// API endpoint to validate GitHub tokens directly
app.post('/auth/validate-github', async (req, res) => {
  const { github_token } = req.body;
  
  if (!github_token) {
    return res.status(400).json({
      error: 'missing_token',
      message: 'GitHub token is required'
    });
  }
  
  try {
    // Validate token with GitHub API
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${github_token}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });
    
    if (!userResponse.ok) {
      return res.status(401).json({
        error: 'invalid_token',
        message: 'Invalid GitHub token'
      });
    }
    
    const userData: GitHubUser = await userResponse.json();
    
    // Generate JWT token for MCP server
    const jwtToken = generateJWT(userData.login);
    
    res.json({
      valid: true,
      user: {
        id: userData.id,
        login: userData.login,
        name: userData.name,
        email: userData.email,
        avatar_url: userData.avatar_url,
      },
      jwt_token: jwtToken
    });
    
  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).json({
      error: 'server_error',
      message: 'Internal server error during validation'
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'github-oauth-mcp-server',
    github_configured: !!(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET)
  });
});

// Instructions endpoint
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>MCP PostgreSQL Server - GitHub OAuth</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
        .endpoint { background: #f8f9fa; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .config-status { padding: 10px; border-radius: 5px; }
        .configured { background: #d4edda; color: #155724; }
        .not-configured { background: #f8d7da; color: #721c24; }
      </style>
    </head>
    <body>
      <h1>🔐 MCP PostgreSQL Server - GitHub OAuth</h1>
      
      <div class="config-status ${GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET ? 'configured' : 'not-configured'}">
        <strong>Configuration Status:</strong> 
        ${GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET ? '✅ GitHub OAuth Configured' : '❌ GitHub OAuth Not Configured'}
      </div>
      
      <h2>Available Endpoints:</h2>
      
      <div class="endpoint">
        <strong>GET /auth/github</strong><br>
        Start GitHub OAuth flow - redirects to GitHub for authentication
      </div>
      
      <div class="endpoint">
        <strong>GET /auth/callback</strong><br>
        OAuth callback endpoint (configured in GitHub app)
      </div>
      
      <div class="endpoint">
        <strong>POST /auth/validate-github</strong><br>
        Validate GitHub token directly: <code>{"github_token": "your_token"}</code>
      </div>
      
      <div class="endpoint">
        <strong>GET /health</strong><br>
        Health check and configuration status
      </div>
      
      ${!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET ? `
      <h2>⚠️ Setup Required</h2>
      <p>Please configure GitHub OAuth by setting these environment variables:</p>
      <ul>
        <li><code>GITHUB_CLIENT_ID</code> - Your GitHub OAuth app client ID</li>
        <li><code>GITHUB_CLIENT_SECRET</code> - Your GitHub OAuth app client secret</li>
        <li><code>GITHUB_REDIRECT_URI</code> - OAuth callback URL (default: http://localhost:3000/auth/callback)</li>
      </ul>
      ` : `
      <h2>🚀 Ready to Use</h2>
      <p><a href="/auth/github">Click here to authenticate with GitHub</a></p>
      `}
    </body>
    </html>
  `);
});

// Start the server
const port = config.SERVER_PORT;
const host = config.SERVER_HOST;

app.listen(port, host, () => {
  console.log(`GitHub OAuth server running on http://${host}:${port}`);
  console.log(`Start auth flow: http://${host}:${port}/auth/github`);
  console.log(`GitHub configured: ${!!(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET)}`);
});

export default app;