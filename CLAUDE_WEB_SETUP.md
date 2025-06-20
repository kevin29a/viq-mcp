# Claude Web Integration Setup

## 🚀 Quick Start

Your unified PostgreSQL server is ready for Claude Web! 

### Start the Server
```bash
npm run dev:unified
```

### Configure Claude Web
In Claude Web, add a new server with these settings:

- **Client ID**: `Ov23liTdld59g0yCI60Q`
- **Server URL**: `http://localhost:3000`

That's it! Claude Web will handle the OAuth flow automatically.

## 🔧 What This Server Provides

### OAuth 2.0 Endpoints (for Claude Web)
- `GET /oauth/authorize` - OAuth authorization endpoint
- `POST /oauth/token` - Token exchange endpoint
- `GET /.well-known/oauth-authorization-server` - OAuth discovery

### Database API Endpoints (for Claude to use)
- `GET /api/tables` - List all database tables
- `GET /api/tables/:name` - Get table schema and sample data  
- `POST /api/query` - Execute SQL queries

### Manual Testing
- `GET /` - Server status and documentation
- `GET /auth/callback` - Manual OAuth callback for browser testing
- `GET /health` - Health check

## 🔐 Authentication Flow

1. **Claude Web** redirects user to `/oauth/authorize`
2. **Server** redirects to GitHub OAuth
3. **User** authorizes on GitHub
4. **GitHub** redirects back with auth code
5. **Server** exchanges code for GitHub token
6. **Server** validates user with GitHub API
7. **Server** returns JWT access token to Claude
8. **Claude** uses JWT token for all API requests

## 📊 Available Data

The PostgreSQL database includes sample tables:
- **users** - User accounts (id, name, email, created_at)
- **products** - Product catalog (id, name, price, description, category)
- **orders** - Order history (id, user_id, product_id, quantity, total_amount)

## 🛠️ Development

### Test OAuth Flow Manually
1. Start server: `npm run dev:unified`
2. Visit: http://localhost:3000
3. Click authentication link to test GitHub OAuth

### Test API Endpoints
```bash
# Get access token first (via OAuth flow)
export TOKEN="your_jwt_token_here"

# List tables
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/tables

# Get table details
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/tables/users

# Execute query
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sql":"SELECT * FROM users LIMIT 3"}' \
  http://localhost:3000/api/query
```

## 🔒 Security Features

- **GitHub OAuth** - Users authenticate with their GitHub accounts
- **JWT Tokens** - Secure, stateless authentication
- **CORS Protection** - Configured for Claude Web domains
- **SQL Injection Protection** - Parameterized queries
- **Token Validation** - All API endpoints require valid JWT