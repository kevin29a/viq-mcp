#!/usr/bin/env node

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { Pool } from 'pg';
import { config } from './config.js';
import { authenticateRequest, AuthenticationError } from './auth.js';

// PostgreSQL connection pool
const pool = new Pool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  database: config.DB_NAME,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Server setup
const server = new Server(
  {
    name: 'postgres-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

// Authentication middleware wrapper
function withAuth<T>(
  handler: (request: T, authContext: any) => Promise<any>
) {
  return async (request: T) => {
    try {
      // For now, we'll extract auth from a custom header or argument
      // In a real implementation, this would come from the MCP transport layer
      const authHeader = (request as any).params?.arguments?.auth_header;
      const authContext = authenticateRequest(authHeader);
      
      if (!authContext.authenticated) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Authentication required'
        );
      }
      
      return await handler(request, authContext);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Authentication failed: ${error.message}`
        );
      }
      throw error;
    }
  };
}

// List available resources
server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
  try {
    const client = await pool.connect();
    try {
      // Get list of tables
      const tablesResult = await client.query(`
        SELECT table_name, table_type 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name
      `);
      
      const resources = tablesResult.rows.map(row => ({
        uri: `postgres://table/${row.table_name}`,
        name: `Table: ${row.table_name}`,
        description: `PostgreSQL table: ${row.table_name} (${row.table_type})`,
        mimeType: 'application/json',
      }));
      
      return { resources };
    } finally {
      client.release();
    }
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to list resources: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
});

// Read a specific resource
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  
  if (!uri.startsWith('postgres://table/')) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'Invalid resource URI'
    );
  }
  
  const tableName = uri.replace('postgres://table/', '');
  
  try {
    const client = await pool.connect();
    try {
      // Get table schema
      const schemaResult = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [tableName]);
      
      if (schemaResult.rows.length === 0) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Table '${tableName}' not found`
        );
      }
      
      // Get sample data (first 10 rows)
      const dataResult = await client.query(`SELECT * FROM "${tableName}" LIMIT 10`);
      
      const content = {
        schema: schemaResult.rows,
        sampleData: dataResult.rows,
        totalRows: dataResult.rowCount || 0,
      };
      
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(content, null, 2),
          },
        ],
      };
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to read resource: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
});

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async (request) => {
  return {
    tools: [
      {
        name: 'query',
        description: 'Execute a PostgreSQL query',
        inputSchema: {
          type: 'object',
          properties: {
            sql: {
              type: 'string',
              description: 'The SQL query to execute',
            },
            auth_header: {
              type: 'string',
              description: 'Authentication header (Bearer token or ApiKey)',
            },
          },
          required: ['sql'],
        },
      },
      {
        name: 'describe_table',
        description: 'Get detailed information about a table',
        inputSchema: {
          type: 'object',
          properties: {
            table_name: {
              type: 'string',
              description: 'The name of the table to describe',
            },
            auth_header: {
              type: 'string',
              description: 'Authentication header (Bearer token or ApiKey)',
            },
          },
          required: ['table_name'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  if (name === 'query') {
    const { sql } = args as { sql: string };
    
    try {
      const client = await pool.connect();
      try {
        const result = await client.query(sql);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                rows: result.rows,
                rowCount: result.rowCount,
                command: result.command,
              }, null, 2),
            },
          ],
        };
      } finally {
        client.release();
      }
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Query failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
  
  if (name === 'describe_table') {
    const { table_name } = args as { table_name: string };
    
    try {
      const client = await pool.connect();
      try {
        // Get table schema with detailed information
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
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Table '${table_name}' not found`
          );
        }
        
        // Get row count
        const countResult = await client.query(`SELECT COUNT(*) FROM "${table_name}"`);
        const rowCount = parseInt(countResult.rows[0].count);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                tableName: table_name,
                columns: schemaResult.rows,
                totalRows: rowCount,
              }, null, 2),
            },
          ],
        };
      } finally {
        client.release();
      }
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to describe table: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
  
  throw new McpError(
    ErrorCode.MethodNotFound,
    `Unknown tool: ${name}`
  );
});

// Start the server
async function main() {
  try {
    // Test database connection
    const client = await pool.connect();
    console.error('Connected to PostgreSQL database');
    client.release();
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('MCP PostgreSQL server running');
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();