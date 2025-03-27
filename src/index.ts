#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express, { Request, Response } from 'express';
import { z } from 'zod';
import { TrelloClient } from './trello-client.js';
import { validateAddCardRequest, validateUpdateCardRequest } from './validators.js';

import 'dotenv/config';

class TrelloServer {
  private server: McpServer;
  private trelloClient: TrelloClient;
  private transports: { [sessionId: string]: SSEServerTransport } = {};

  constructor() {
    const apiKey = process.env.TRELLO_API_KEY;
    const token = process.env.TRELLO_TOKEN;
    const boardId = process.env.TRELLO_BOARD_ID;

    if (!apiKey || !token || !boardId) {
      throw new Error(
        'TRELLO_API_KEY, TRELLO_TOKEN, and TRELLO_BOARD_ID environment variables are required'
      );
    }

    this.trelloClient = new TrelloClient({ apiKey, token, boardId });

    this.server = new McpServer({
      name: 'trello-server',
      version: '0.1.0',
    });

    this.setupToolHandlers();

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.tool(
      'get_cards_by_list_id',
      {
        listId: z.string().describe('ID of the Trello list'),
      },
      async ({ listId }: { listId: string }) => {
        const cards = await this.trelloClient.getCardsByList(listId);
        return {
          content: [{ type: 'text', text: JSON.stringify(cards, null, 2) }],
        };
      }
    );

    this.server.tool('get_lists', {}, async () => {
      const lists = await this.trelloClient.getLists();
      return {
        content: [{ type: 'text', text: JSON.stringify(lists, null, 2) }],
      };
    });

    this.server.tool(
      'get_recent_activity',
      {
        limit: z.number().optional().describe('Number of activities to fetch (default: 10)'),
      },
      async ({ limit }: { limit?: number }) => {
        const activity = await this.trelloClient.getRecentActivity(limit);
        return {
          content: [{ type: 'text', text: JSON.stringify(activity, null, 2) }],
        };
      }
    );

    this.server.tool(
      'add_card_to_list',
      {
        listId: z.string().describe('ID of the list to add the card to'),
        name: z.string().describe('Name of the card'),
        description: z.string().optional().describe('Description of the card'),
        dueDate: z.string().optional().describe('Due date for the card (ISO 8601 format)'),
        labels: z.array(z.string()).optional().describe('Array of label IDs to apply to the card'),
      },
      async (args: {
        listId: string;
        name: string;
        description?: string;
        dueDate?: string;
        labels?: string[];
      }) => {
        const validArgs = validateAddCardRequest(args);
        const card = await this.trelloClient.addCard(validArgs);
        return {
          content: [{ type: 'text', text: JSON.stringify(card, null, 2) }],
        };
      }
    );

    this.server.tool(
      'update_card_details',
      {
        cardId: z.string().describe('ID of the card to update'),
        name: z.string().optional().describe('New name for the card'),
        description: z.string().optional().describe('New description for the card'),
        dueDate: z.string().optional().describe('New due date for the card (ISO 8601 format)'),
        labels: z.array(z.string()).optional().describe('New array of label IDs for the card'),
      },
      async (args: {
        cardId: string;
        name?: string;
        description?: string;
        dueDate?: string;
        labels?: string[];
      }) => {
        const validArgs = validateUpdateCardRequest(args);
        const card = await this.trelloClient.updateCard(validArgs);
        return {
          content: [{ type: 'text', text: JSON.stringify(card, null, 2) }],
        };
      }
    );

    this.server.tool(
      'archive_card',
      {
        cardId: z.string().describe('ID of the card to archive'),
      },
      async ({ cardId }: { cardId: string }) => {
        const card = await this.trelloClient.archiveCard(cardId);
        return {
          content: [{ type: 'text', text: JSON.stringify(card, null, 2) }],
        };
      }
    );

    this.server.tool(
      'add_list_to_board',
      {
        name: z.string().describe('Name of the new list'),
      },
      async ({ name }: { name: string }) => {
        const list = await this.trelloClient.addList(name);
        return {
          content: [{ type: 'text', text: JSON.stringify(list, null, 2) }],
        };
      }
    );

    this.server.tool(
      'archive_list',
      {
        listId: z.string().describe('ID of the list to archive'),
      },
      async ({ listId }: { listId: string }) => {
        const list = await this.trelloClient.archiveList(listId);
        return {
          content: [{ type: 'text', text: JSON.stringify(list, null, 2) }],
        };
      }
    );

    this.server.tool('get_my_cards', {}, async () => {
      const cards = await this.trelloClient.getMyCards();
      return {
        content: [{ type: 'text', text: JSON.stringify(cards, null, 2) }],
      };
    });
  }

  async run() {
    const app = express();
    const port = process.env.PORT;

    // SSE endpoint for client connections
    app.get('/sse', async (_: Request, res: Response) => {
      const transport = new SSEServerTransport('/messages', res);
      this.transports[transport.sessionId] = transport;
      res.on('close', () => {
        delete this.transports[transport.sessionId];
      });
      await this.server.connect(transport);
    });

    // Messages endpoint for client requests
    app.post('/messages', async (req: Request, res: Response) => {
      const sessionId = req.query.sessionId as string;
      const transport = this.transports[sessionId];
      if (transport) {
        await transport.handlePostMessage(req, res);
      } else {
        res.status(400).send('No transport found for sessionId');
      }
    });

    app.listen(port, () => {
      console.error(`Trello MCP server running on http://localhost:${port}`);
    });
  }
}

const server = new TrelloServer();
server.run().catch(console.error);
