import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { Pool } from 'pg';
import { config } from './config.js';
import { generateJWT, verifyJWT, AuthenticationError } from './auth.js';

const app = express();

// Database connection pool (RDS PostgreSQL)
const pool = new Pool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  database: config.DB_NAME,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000, // Increased for network latency
  ssl: config.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false, // SSL for RDS
});

// Middleware
app.use(cors({
  origin: ['https://claude.ai', 'http://localhost:3000'],
  credentials: true
}));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Debug: Log ALL requests (early in middleware chain)
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.path}`);
  if (req.headers.authorization) {
    console.log('   Auth: Bearer token present');
  }
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('   Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

// GitHub OAuth configuration
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const PUBLIC_URL = process.env.PUBLIC_URL; // EC2 public URL
const BASE_URL = PUBLIC_URL || `http://localhost:${config.SERVER_PORT}`;
const GITHUB_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI || `${BASE_URL}/auth/callback`;

interface GitHubUser {
  id: number;
  login: string;
  name: string;
  email: string;
  avatar_url: string;
}

// Authentication middleware
const requireAuth = async (req: any, res: any, next: any) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Bearer token required'
      });
    }
    
    const token = authHeader.substring(7);
    const decoded = verifyJWT(token);
    req.user = decoded;
    next();
    
  } catch (error) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Invalid or expired token'
    });
  }
};

// ============================================================================
// OAUTH ENDPOINTS (for Claude Web to handle authentication)
// ============================================================================

// OAuth 2.0 Authorization - Step 1: Redirect to GitHub
app.get('/oauth/authorize', (req, res) => {
  const { client_id, redirect_uri, state, response_type } = req.query;
  
  // Validate client_id matches our GitHub app
  if (client_id !== GITHUB_CLIENT_ID) {
    return res.status(400).json({
      error: 'invalid_client',
      error_description: 'Invalid client_id'
    });
  }
  
  // Store Claude's redirect_uri and state for later use
  const encodedState = Buffer.from(JSON.stringify({
    claude_redirect_uri: redirect_uri,
    claude_state: state
  })).toString('base64');
  
  const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
  githubAuthUrl.searchParams.append('client_id', GITHUB_CLIENT_ID || '');
  githubAuthUrl.searchParams.append('redirect_uri', GITHUB_REDIRECT_URI);
  githubAuthUrl.searchParams.append('scope', 'user:email');
  githubAuthUrl.searchParams.append('state', encodedState);
  
  res.redirect(githubAuthUrl.toString());
});

// OAuth 2.0 Token Exchange - Step 2: Exchange code for token
app.post('/oauth/token', async (req, res) => {
  console.log('🔄 Token exchange request:', {
    body: req.body,
    headers: req.headers
  });
  
  const { grant_type, code, client_id, client_secret, redirect_uri, code_verifier } = req.body;
  
  if (grant_type !== 'authorization_code') {
    console.log('❌ Invalid grant type:', grant_type);
    return res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: 'Only authorization_code grant type is supported'
    });
  }
  
  // Validate client_id
  if (client_id !== GITHUB_CLIENT_ID) {
    console.log('❌ Invalid client_id:', { client_id });
    return res.status(401).json({
      error: 'invalid_client',
      error_description: 'Invalid client_id'
    });
  }
  
  // Claude Web uses PKCE (code_verifier) instead of client_secret
  // For PKCE flow, we don't validate client_secret, just client_id
  console.log('✅ PKCE flow detected, client_id validated:', { 
    client_id, 
    has_code_verifier: !!code_verifier,
    has_client_secret: !!client_secret 
  });
  
  try {
    // Exchange code with GitHub
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code: code,
        redirect_uri: GITHUB_REDIRECT_URI,
      }),
    });
    
    const tokenData = await tokenResponse.json();
    
    if (tokenData.error) {
      return res.status(400).json({
        error: tokenData.error,
        error_description: tokenData.error_description || 'Failed to exchange code for token'
      });
    }
    
    // Get user info from GitHub
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });
    
    const userData: GitHubUser = await userResponse.json();
    
    // Generate our JWT token
    const accessToken = generateJWT(userData.login);
    
    console.log('✅ Token exchange successful for user:', userData.login);
    
    // Return OAuth 2.0 compliant response
    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 86400, // 24 hours
      scope: 'database:read database:write',
    });
    
  } catch (error) {
    console.error('❌ OAuth token exchange error:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error during token exchange'
    });
  }
});

// GitHub OAuth callback - redirect back to Claude Web
app.get('/auth/callback', async (req, res) => {
  console.log('🔄 OAuth callback received:', { 
    code: !!req.query.code, 
    state: !!req.query.state, 
    error: req.query.error 
  });
  
  const { code, state, error } = req.query;
  
  if (error) {
    // GitHub OAuth error - redirect back to Claude with error
    try {
      const decodedState = JSON.parse(Buffer.from(state as string, 'base64').toString());
      const claudeRedirectUrl = new URL(decodedState.claude_redirect_uri);
      claudeRedirectUrl.searchParams.append('error', error as string);
      claudeRedirectUrl.searchParams.append('state', decodedState.claude_state || '');
      return res.redirect(claudeRedirectUrl.toString());
    } catch (e) {
      return res.status(400).send('Invalid state parameter');
    }
  }
  
  if (!code) {
    return res.status(400).send('Authorization code not provided');
  }
  
  try {
    // Decode the state to get Claude's original redirect_uri
    const decodedState = JSON.parse(Buffer.from(state as string, 'base64').toString());
    
    // Redirect back to Claude Web with the authorization code
    const claudeRedirectUrl = new URL(decodedState.claude_redirect_uri);
    claudeRedirectUrl.searchParams.append('code', code as string);
    claudeRedirectUrl.searchParams.append('state', decodedState.claude_state || '');
    
    console.log('↩️ Redirecting back to Claude:', claudeRedirectUrl.toString());
    res.redirect(claudeRedirectUrl.toString());
    
  } catch (error) {
    console.error('Callback error:', error);
    res.status(500).send('Authentication callback failed');
  }
});

// ============================================================================
// MCP PROTOCOL ENDPOINTS (for Claude Web to access data)
// ============================================================================


// MCP Handler Functions
async function handleListResources(req: any, res: any, id: any) {
  console.log('📚 Listing resources...');
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT table_name, table_type 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    const resources = result.rows.map(row => ({
      uri: `postgres://table/${row.table_name}`,
      name: `Table: ${row.table_name}`,
      description: `PostgreSQL table: ${row.table_name} (${row.table_type})`,
      mimeType: 'application/json',
    }));
    
    res.json({
      jsonrpc: '2.0',
      id,
      result: { resources }
    });
  } finally {
    client.release();
  }
}

async function handleReadResource(req: any, res: any, id: any, params: any) {
  const { uri } = params;
  
  if (!uri.startsWith('postgres://table/')) {
    return res.json({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32602,
        message: 'Invalid resource URI'
      }
    });
  }
  
  const tableName = uri.replace('postgres://table/', '');
  const client = await pool.connect();
  
  try {
    // Get schema
    const schemaResult = await client.query(`
      SELECT 
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        CASE WHEN pk.column_name IS NOT NULL THEN 'YES' ELSE 'NO' END as is_primary_key
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT ku.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage ku
          ON tc.constraint_name = ku.constraint_name
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name = $1
      ) pk ON c.column_name = pk.column_name
      WHERE c.table_schema = 'public' AND c.table_name = $1
      ORDER BY c.ordinal_position
    `, [tableName]);
    
    if (schemaResult.rows.length === 0) {
      return res.json({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32602,
          message: `Table '${tableName}' not found`
        }
      });
    }
    
    // Get sample data
    const dataResult = await client.query(`SELECT * FROM "${tableName}" LIMIT 10`);
    const countResult = await client.query(`SELECT COUNT(*) FROM "${tableName}"`);
    
    const content = {
      schema: schemaResult.rows,
      sampleData: dataResult.rows,
      totalRows: parseInt(countResult.rows[0].count)
    };
    
    res.json({
      jsonrpc: '2.0',
      id,
      result: {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(content, null, 2)
        }]
      }
    });
  } finally {
    client.release();
  }
}

async function handleListTools(req: any, res: any, id: any) {
  console.log('📋 Listing tools...');
  res.json({
    jsonrpc: '2.0',
    id,
    result: {
      tools: [
        {
          name: 'query',
          description: 'Execute a PostgreSQL query',
          inputSchema: {
            type: 'object',
            properties: {
              sql: {
                type: 'string',
                description: 'The SQL query to execute'
              }
            },
            required: ['sql']
          }
        },
        {
          name: 'describe_table',
          description: 'Get detailed information about a table',
          inputSchema: {
            type: 'object',
            properties: {
              table_name: {
                type: 'string',
                description: 'The name of the table to describe'
              }
            },
            required: ['table_name']
          }
        }
      ]
    }
  });
}

async function handleCallTool(req: any, res: any, id: any, params: any) {
  const { name, arguments: args } = params;
  
  if (name === 'query') {
    const { sql } = args;
    const client = await pool.connect();
    
    try {
      const result = await client.query(sql);
      
      res.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              rows: result.rows,
              rowCount: result.rowCount,
              command: result.command
            }, null, 2)
          }]
        }
      });
    } finally {
      client.release();
    }
  } else if (name === 'describe_table') {
    const { table_name } = args;
    const client = await pool.connect();
    
    try {
      const schemaResult = await client.query(`
        SELECT 
          c.column_name,
          c.data_type,
          c.is_nullable,
          c.column_default,
          c.character_maximum_length,
          c.numeric_precision,
          c.numeric_scale,
          CASE WHEN pk.column_name IS NOT NULL THEN 'YES' ELSE 'NO' END as is_primary_key
        FROM information_schema.columns c
        LEFT JOIN (
          SELECT ku.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage ku
            ON tc.constraint_name = ku.constraint_name
          WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_schema = 'public'
            AND tc.table_name = $1
        ) pk ON c.column_name = pk.column_name
        WHERE c.table_schema = 'public' AND c.table_name = $1
        ORDER BY c.ordinal_position
      `, [table_name]);
      
      if (schemaResult.rows.length === 0) {
        return res.json({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: `Table '${table_name}' not found`
          }
        });
      }
      
      const countResult = await client.query(`SELECT COUNT(*) FROM "${table_name}"`);
      
      res.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              tableName: table_name,
              columns: schemaResult.rows,
              totalRows: parseInt(countResult.rows[0].count)
            }, null, 2)
          }]
        }
      });
    } finally {
      client.release();
    }
  } else {
    res.json({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Unknown tool: ${name}`
      }
    });
  }
}


// Alternative MCP endpoints (in case Claude Web expects different paths)
app.post('/api/mcp', requireAuth, async (req, res) => {
  console.log('🔄 MCP request via /api/mcp');
  return handleMcpRequest(req, res);
});

app.post('/mcp/v1', requireAuth, async (req, res) => {
  console.log('🔄 MCP request via /mcp/v1');
  return handleMcpRequest(req, res);
});

// Extract MCP logic into reusable function
async function handleMcpRequest(req: any, res: any) {
  const { id, method, params } = req.body;
  
  console.log('🔄 MCP request received:');
  console.log('  Method:', method);
  console.log('  ID:', id);
  console.log('  Params:', JSON.stringify(params, null, 2));
  
  try {
    switch (method) {
      case 'resources/list':
        return await handleListResources(req, res, id);
      case 'resources/read':
        return await handleReadResource(req, res, id, params);
      case 'tools/list':
        return await handleListTools(req, res, id);
      case 'tools/call':
        return await handleCallTool(req, res, id, params);
      case 'initialize':
        console.log('🚀 Initializing MCP server...');
        
        // Get available resources immediately for Claude Web
        const client = await pool.connect();
        let resources: any[] = [];
        try {
          const result = await client.query(`
            SELECT table_name, table_type 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
          `);
          
          resources = result.rows.map(row => ({
            uri: `postgres://table/${row.table_name}`,
            name: `Table: ${row.table_name}`,
            description: `PostgreSQL table: ${row.table_name} (${row.table_type})`,
            mimeType: 'application/json',
          }));
        } finally {
          client.release();
        }
        
        const tools = [
          {
            name: 'query',
            description: 'Execute a PostgreSQL query',
            inputSchema: {
              type: 'object',
              properties: {
                sql: {
                  type: 'string',
                  description: 'The SQL query to execute'
                }
              },
              required: ['sql']
            }
          },
          {
            name: 'describe_table',
            description: 'Get detailed information about a table',
            inputSchema: {
              type: 'object',
              properties: {
                table_name: {
                  type: 'string',
                  description: 'The name of the table to describe'
                }
              },
              required: ['table_name']
            }
          }
        ];
        
        const initResponse = {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              resources: {
                subscribe: false,
                listChanged: false
              },
              tools: {
                listChanged: false
              }
            },
            serverInfo: {
              name: 'postgres-mcp-server',
              version: '1.0.0'
            },
            // Include resources and tools directly for Claude Web
            resources: resources,
            tools: tools
          }
        };
        console.log('📤 Sending initialize response with embedded resources/tools');
        console.log(`   Found ${resources.length} tables and ${tools.length} tools`);
        return res.json(initResponse);
      case 'notifications/initialized':
        console.log('✅ Client confirmed initialization');
        console.log('📢 Sending tools/list_changed notification to trigger discovery');
        
        // Return the notification that triggers Claude to discover tools/resources
        return res.json({
          jsonrpc: '2.0',
          method: 'notifications/tools/list_changed'
        });
      default:
        return res.json({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: 'Method not found',
            data: { method }
          }
        });
    }
  } catch (error) {
    console.error('MCP error:', error);
    return res.json({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: 'Internal error',
        data: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
}

// Update main MCP endpoint to use shared handler
app.post('/mcp', requireAuth, async (req, res) => {
  console.log('🔄 MCP request via /mcp');
  return handleMcpRequest(req, res);
});

// Legacy REST endpoints (keep for manual testing)
// Get list of tables
app.get('/api/tables', requireAuth, async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT table_name, table_type 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name
      `);
      
      res.json({
        tables: result.rows
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching tables:', error);
    res.status(500).json({
      error: 'database_error',
      message: 'Failed to fetch tables'
    });
  }
});

// Get table schema and sample data
app.get('/api/tables/:tableName', requireAuth, async (req, res) => {
  const { tableName } = req.params;
  
  try {
    const client = await pool.connect();
    try {
      // Get schema
      const schemaResult = await client.query(`
        SELECT 
          c.column_name,
          c.data_type,
          c.is_nullable,
          c.column_default,
          c.character_maximum_length,
          CASE WHEN pk.column_name IS NOT NULL THEN 'YES' ELSE 'NO' END as is_primary_key
        FROM information_schema.columns c
        LEFT JOIN (
          SELECT ku.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage ku
            ON tc.constraint_name = ku.constraint_name
          WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_schema = 'public'
            AND tc.table_name = $1
        ) pk ON c.column_name = pk.column_name
        WHERE c.table_schema = 'public' AND c.table_name = $1
        ORDER BY c.ordinal_position
      `, [tableName]);
      
      if (schemaResult.rows.length === 0) {
        return res.status(404).json({
          error: 'table_not_found',
          message: `Table '${tableName}' not found`
        });
      }
      
      // Get sample data
      const dataResult = await client.query(`SELECT * FROM "${tableName}" LIMIT 10`);
      
      // Get row count
      const countResult = await client.query(`SELECT COUNT(*) FROM "${tableName}"`);
      
      res.json({
        table_name: tableName,
        schema: schemaResult.rows,
        sample_data: dataResult.rows,
        total_rows: parseInt(countResult.rows[0].count)
      });
      
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching table:', error);
    res.status(500).json({
      error: 'database_error',
      message: `Failed to fetch table '${tableName}'`
    });
  }
});

// Execute SQL query
app.post('/api/query', requireAuth, async (req, res) => {
  const { sql } = req.body;
  
  if (!sql) {
    return res.status(400).json({
      error: 'missing_sql',
      message: 'SQL query is required'
    });
  }
  
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(sql);
      
      res.json({
        rows: result.rows,
        row_count: result.rowCount,
        command: result.command,
        fields: result.fields?.map((f: any) => ({ name: f.name, type: f.dataTypeID }))
      });
      
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Query error:', error);
    res.status(400).json({
      error: 'query_error',
      message: error instanceof Error ? error.message : 'Query execution failed'
    });
  }
});

// ============================================================================
// UTILITY ENDPOINTS
// ============================================================================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'unified-postgres-server',
    github_configured: !!(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET),
    database_connected: true // TODO: Add actual DB health check
  });
});

// Server info (for Claude Web integration)
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  res.json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/oauth/authorize`,
    token_endpoint: `${BASE_URL}/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256', 'plain'],
    scopes_supported: ['database:read', 'database:write']
  });
});

// MCP server discovery
app.get('/.well-known/mcp-server', (req, res) => {
  console.log('🔍 MCP discovery requested');
  res.json({
    version: '2024-11-05',
    protocol: 'http-mcp',
    endpoints: {
      rpc: `${BASE_URL}/mcp`
    },
    capabilities: {
      resources: {},
      tools: {}
    },
    serverInfo: {
      name: 'postgres-mcp-server',
      version: '1.0.0'
    }
  });
});

// Alternative discovery endpoints
app.get('/mcp/capabilities', (req, res) => {
  console.log('🔍 MCP capabilities requested');
  res.json({
    capabilities: {
      resources: {},
      tools: {}
    }
  });
});

// Root endpoint - handle both GET (docs) and POST (MCP)
app.post('/', requireAuth, async (req, res) => {
  console.log('🔄 MCP request via / (root) - AUTH ENABLED');
  return handleMcpRequest(req, res);
});

// MCP endpoints that co-worker might have used - handle all methods
app.all('/mcp', async (req, res) => {
  console.log(`🔄 MCP request via /mcp endpoint (${req.method})`);
  if (req.method === 'GET') {
    return res.json({ status: 'MCP endpoint ready', method: 'GET' });
  }
  return handleMcpRequest(req, res);
});

// Handle POST to /sse for MCP
app.post('/sse', async (req, res) => {
  console.log('🔄 MCP POST request via /sse endpoint');
  return handleMcpRequest(req, res);
});

// With auth versions
app.all('/mcp/auth', requireAuth, async (req, res) => {
  console.log(`🔄 MCP request via /mcp/auth endpoint (${req.method})`);
  if (req.method === 'GET') {
    return res.json({ status: 'MCP auth endpoint ready', method: 'GET' });
  }
  return handleMcpRequest(req, res);
});

// SSE might be Server-Sent Events - different handling
app.get('/sse', (req, res) => {
  console.log('🔄 SSE GET request - setting up Server-Sent Events');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  
  // Send initial SSE message
  res.write('data: {"type": "connection", "status": "connected"}\n\n');
  
  // Keep connection alive
  const keepAlive = setInterval(() => {
    res.write('data: {"type": "ping"}\n\n');
  }, 30000);
  
  req.on('close', () => {
    clearInterval(keepAlive);
    console.log('🔌 SSE connection closed');
  });
});

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Unified PostgreSQL API Server</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
        .endpoint { background: #f8f9fa; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .configured { background: #d4edda; color: #155724; padding: 10px; border-radius: 5px; }
        .not-configured { background: #f8d7da; color: #721c24; padding: 10px; border-radius: 5px; }
      </style>
    </head>
    <body>
      <h1>🔐 Unified PostgreSQL API Server</h1>
      
      <div class="${GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET ? 'configured' : 'not-configured'}">
        <strong>Status:</strong> 
        ${GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET ? '✅ Ready for Claude Web' : '❌ GitHub OAuth Not Configured'}
      </div>
      
      <h2>For Claude Web Integration</h2>
      <p><strong>Client ID:</strong> <code>${GITHUB_CLIENT_ID || 'Not configured'}</code></p>
      <p><strong>Server URL:</strong> <code>${BASE_URL}</code></p>
      
      <h2>API Endpoints</h2>
      <div class="endpoint"><strong>GET /api/tables</strong> - List all database tables</div>
      <div class="endpoint"><strong>GET /api/tables/:name</strong> - Get table schema and sample data</div>
      <div class="endpoint"><strong>POST /api/query</strong> - Execute SQL query</div>
      
      <h2>OAuth Endpoints</h2>
      <div class="endpoint"><strong>GET /oauth/authorize</strong> - Start OAuth flow</div>
      <div class="endpoint"><strong>POST /oauth/token</strong> - Exchange code for token</div>
      
      ${GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET ? `
      <h2>🚀 Test Authentication</h2>
      <p><a href="/auth/callback?code=test">Manual test authentication</a></p>
      ` : ''}
    </body>
    </html>
  `);
});

// Start the server
const port = config.SERVER_PORT;
const host = config.SERVER_HOST;

async function startServer() {
  try {
    // Test database connection
    const client = await pool.connect();
    console.log('✅ Connected to PostgreSQL database');
    client.release();
    
    app.listen(port, host, () => {
      console.log(`🚀 Unified server running on http://${host}:${port}`);
      console.log(`🌐 Public URL: ${BASE_URL}`);
      console.log(`📋 Client ID for Claude Web: ${GITHUB_CLIENT_ID}`);
      console.log(`🔗 Server URL for Claude Web: ${BASE_URL}`);
      console.log(`✅ GitHub OAuth configured: ${!!(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET)}`);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();