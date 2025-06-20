#!/usr/bin/env node

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';

const app = express();

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'mcp_database',
  user: process.env.DB_USER || 'mcp_user',
  password: process.env.DB_PASSWORD || 'mcp_password',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Middleware
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(express.json());

// Log all requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

// MCP JSON-RPC handler
async function handleMcpRequest(req: any, res: any) {
  const { id, method, params } = req.body;
  
  console.log(`MCP: ${method}`);
  
  try {
    switch (method) {
      case 'initialize':
        console.log('📋 Initialize request received');
        const response = {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              resources: {
                subscribe: true,
                listChanged: true
              },
              tools: {
                listChanged: true
              },
              logging: {}
            },
            serverInfo: {
              name: 'simple-postgres-mcp',
              version: '1.0.0'
            }
          }
        };
        console.log('📤 Sending capabilities:', JSON.stringify(response.result.capabilities, null, 2));
        return res.json(response);
        
      case 'notifications/initialized':
        console.log('✅ Client initialization confirmed');
        console.log('📢 Sending tools/list_changed notification to trigger discovery');
        
        // Send notification that tools list has changed
        setTimeout(() => {
          console.log('🔄 Notifying Claude about available tools and resources');
          // This would normally be sent via a separate connection, 
          // but let's try responding with the notification
        }, 100);
        
        // Return the notification as suggested
        return res.json({
          jsonrpc: '2.0',
          method: 'notifications/tools/list_changed'
        });
        
      case 'notifications/resources/list_changed':
        console.log('📚 Resources list changed notification received');
        return res.status(204).end();
        
      case 'resources/list':
        console.log('📚 Resources list requested');
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
            description: `PostgreSQL table: ${row.table_name}`,
            mimeType: 'application/json',
          }));
          
          return res.json({
            jsonrpc: '2.0',
            id,
            result: { resources }
          });
        } finally {
          client.release();
        }
        
      case 'tools/list':
        console.log('🔧 Tools list requested');
        return res.json({
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
                      description: 'SQL query to execute'
                    }
                  },
                  required: ['sql']
                }
              }
            ]
          }
        });
        
      case 'tools/call':
        const { name, arguments: args } = params;
        if (name === 'query') {
          const { sql } = args;
          const client = await pool.connect();
          try {
            const result = await client.query(sql);
            return res.json({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    rows: result.rows,
                    rowCount: result.rowCount
                  }, null, 2)
                }]
              }
            });
          } finally {
            client.release();
          }
        }
        break;
        
      default:
        return res.json({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: 'Method not found'
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
        message: 'Internal error'
      }
    });
  }
}

// MCP endpoints
app.post('/', handleMcpRequest);
app.post('/mcp', (req, res) => {
  console.log('🎯 MCP request received at /mcp endpoint');
  return handleMcpRequest(req, res);
});

// Also handle GET for debugging
app.get('/mcp', (req, res) => {
  console.log('📡 GET request to /mcp');
  res.json({ 
    status: 'MCP endpoint ready',
    capabilities: ['resources', 'tools'],
    endpoint: '/mcp'
  });
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Simple MCP server running' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Start server
const port = 3000;
app.listen(port, () => {
  console.log(`🚀 Simple MCP server running on port ${port}`);
  console.log(`📋 No authentication required`);
});

// Test database connection
pool.connect()
  .then(client => {
    console.log('✅ Connected to PostgreSQL');
    client.release();
  })
  .catch(err => console.error('❌ Database connection failed:', err));