# GitHub OAuth App Setup

## Step 1: Create GitHub OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click "New OAuth App"
3. Fill in the details:
   - **Application name**: `MCP PostgreSQL Server`
   - **Homepage URL**: `http://localhost:3000`
   - **Authorization callback URL**: `http://localhost:3000/auth/callback`
   - **Application description**: `PostgreSQL MCP server with GitHub OAuth authentication`

4. Click "Register application"
5. Copy the **Client ID** and **Client Secret**

## Step 2: Update Environment Variables

Add these to your `.env` file:

```bash
# GitHub OAuth configuration
GITHUB_CLIENT_ID=your_client_id_here
GITHUB_CLIENT_SECRET=your_client_secret_here
GITHUB_REDIRECT_URI=http://localhost:3000/auth/callback
```

## Step 3: Test the Setup

1. Start the GitHub OAuth server:
   ```bash
   npm run dev:github
   ```

2. Open your browser to: http://localhost:3000

3. You should see a setup page with authentication options

4. If configured correctly, click "Start GitHub OAuth" to test the flow

## Step 4: Using with Claude

Once you have your JWT token from the OAuth flow:

1. **For Claude Desktop**: Use the MCP server directly with stdio transport (no OAuth needed)
2. **For Claude Web**: Use the JWT token in the Authorization header: `Bearer your_jwt_token_here`

## Available Endpoints

- `GET /` - Setup instructions and status page
- `GET /auth/github` - Start GitHub OAuth flow
- `GET /auth/callback` - OAuth callback (handled automatically)
- `POST /auth/validate-github` - Direct token validation
- `GET /health` - Health check

## Security Notes

- The JWT secret should be at least 32 characters long
- In production, use HTTPS URLs for all OAuth redirects
- Store client secrets securely (environment variables, not in code)
- Consider implementing additional security measures like rate limiting