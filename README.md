# PostgreSQL MCP Server with Authentication

A Model Context Protocol (MCP) server that provides authenticated access to PostgreSQL databases for Claude AI. Supports Claude Web with GitHub OAuth 2.0 authentication and can be deployed on EC2 with RDS PostgreSQL.

## Features

- 🔐 **GitHub OAuth 2.0 Authentication** - Secure authentication for Claude Web
- 🗄️ **PostgreSQL Integration** - Full database access with schema discovery
- 🛠️ **SQL Query Tool** - Execute custom SQL queries
- 📊 **Resource Discovery** - Browse database tables and schemas
- ☁️ **Production Ready** - Supports EC2 deployment with RDS PostgreSQL
- 🚀 **Easy Setup** - Docker-based PostgreSQL for development

## Quick Start

### 1. Prerequisites

- Node.js 18+
- PostgreSQL database (local Docker or AWS RDS)
- GitHub OAuth App (for Claude Web authentication)
- EC2 instance (for production deployment)

### 2. Installation

```bash
git clone <your-repo-url>
cd mcp-server
npm install
```

### 3. Configuration

Copy the example environment file and configure:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```bash
# Database Configuration (RDS PostgreSQL)
DB_HOST=your-rds-endpoint.region.rds.amazonaws.com
DB_PORT=5432
DB_NAME=your_database_name
DB_USER=your_db_username
DB_PASSWORD=your_db_password

# Server Configuration (EC2)
SERVER_PORT=3000
SERVER_HOST=0.0.0.0
PUBLIC_URL=http://44.200.16.187:3000

# Authentication
JWT_SECRET=your-jwt-secret-at-least-32-characters-long

# GitHub OAuth (for Claude Web)
GITHUB_CLIENT_ID=your_github_oauth_app_client_id
GITHUB_CLIENT_SECRET=your_github_oauth_app_client_secret
GITHUB_REDIRECT_URI=http://44.200.16.187:3000/auth/callback

# Environment
NODE_ENV=production
```

### 4. Development Setup (Optional)

For local development with Docker:

```bash
# Start PostgreSQL with sample data
docker-compose up -d

# Start development server
npm run dev
```

### 5. Production Deployment

#### On EC2:
```bash
# Build the application
npm run build

# Start with PM2 (recommended)
npm run pm2:start

# Or start directly
npm start
```

### 6. Usage

Configure Claude Web:
- **Server URL**: `http://44.200.16.187:3000`
- **Client ID**: `your_github_client_id`

## Architecture

### Files Structure

- `src/index.ts` - Main MCP server (stdio transport for Claude Desktop)
- `src/unified-server.ts` - Authenticated MCP server (HTTP transport for Claude Web)
- `src/auth.ts` - JWT and API key authentication middleware
- `src/config.ts` - Configuration management with Zod validation
- `src/simple-mcp.ts` - Minimal MCP server for testing
- `docker-compose.yml` - PostgreSQL database setup
- `init.sql` - Sample database schema and data

### Database Schema

The server includes sample data with three tables:
- **users** - User accounts (id, name, email, created_at)
- **products** - Product catalog (id, name, price, description, category)  
- **orders** - Order history (id, user_id, product_id, quantity, total_amount)

### Available Tools

- `query` - Execute SQL queries against the database
- `describe_table` - Get detailed table schema information

### Available Resources

- `postgres://table/{table_name}` - Access to individual database tables

## GitHub OAuth Setup

### 1. Create GitHub OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click "New OAuth App"
3. Fill in the details:
   - **Application name**: `MCP PostgreSQL Server`
   - **Homepage URL**: `https://your-ngrok-url.ngrok-free.app`
   - **Authorization callback URL**: `https://your-ngrok-url.ngrok-free.app/auth/callback`

4. Copy the Client ID and Client Secret to your `.env` file

### 2. Update URLs for ngrok

When using ngrok, update both:
- Your `.env` file with the ngrok URL
- Your GitHub OAuth app settings with the new callback URL

## Development

### Available Scripts

- `npm run dev` - Start MCP server (stdio mode)
- `npm run dev:unified` - Start authenticated MCP server (HTTP mode)
- `npm run dev:simple` - Start minimal MCP server for testing
- `npm run build` - Build TypeScript to JavaScript
- `npm run lint` - Run ESLint
- `npm run typecheck` - Run TypeScript type checking

### Testing

Try these prompts in Claude:

```
What tables are available in the database?
Show me some sample data from the users table.
Which user has placed the most orders?
What's the total revenue from all orders?
Run this SQL: SELECT name, email FROM users WHERE created_at > '2020-01-01'
```

## Security

- JWT tokens with configurable secrets
- GitHub OAuth 2.0 with PKCE support
- Parameterized SQL queries to prevent injection
- CORS protection configured for Claude domains
- Environment-based configuration (no secrets in code)

## Troubleshooting

### Common Issues

1. **"No tools, resources, or prompts"** - Make sure the server sends `notifications/tools/list_changed` after initialization
2. **OAuth errors** - Verify GitHub OAuth app callback URLs match your ngrok URL
3. **Database connection fails** - Check that PostgreSQL container is running with `docker-compose ps`
4. **404 errors** - Ensure ngrok is forwarding to the correct port (3000)

### Debug Mode

Enable verbose logging by checking the terminal output when running the server. All MCP requests and OAuth flows are logged.

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Support

- Check the [MCP documentation](https://modelcontextprotocol.io/)
- Review the troubleshooting section above
- Open an issue for bugs or feature requests