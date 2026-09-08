import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { z } from 'zod';
import { supportBridgeFetch, syncMailbox } from './support-sync.mjs';

const CONFIG = {
  user: process.env.NAMECHEAP_PRIVATE_EMAIL_USER,
  password: process.env.NAMECHEAP_PRIVATE_EMAIL_PASSWORD,
  host: process.env.NAMECHEAP_IMAP_HOST || 'mail.privateemail.com',
  port: Number(process.env.NAMECHEAP_IMAP_PORT || 993),
};

function requireConfig() {
  if (!CONFIG.user || !CONFIG.password) {
    throw new Error('Namecheap email credentials are not configured in the local environment.');
  }
}

function createClient() {
  requireConfig();
  return new ImapFlow({
    host: CONFIG.host,
    port: CONFIG.port,
    secure: true,
    auth: { user: CONFIG.user, pass: CONFIG.password },
    logger: false,
  });
}

async function withClient(work) {
  const client = createClient();
  try {
    await client.connect();
    return await work(client);
  } finally {
    if (client.usable) await client.logout().catch(() => {});
  }
}

async function withMailbox(client, path, work) {
  const lock = await client.getMailboxLock(path);
  try {
    return await work(client);
  } finally {
    lock.release();
  }
}

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function safeAddress(address) {
  if (!address) return null;
  if (Array.isArray(address)) return address.map(safeAddress);
  return { name: address.name || null, address: address.address || null };
}

async function parseMessage(message) {
  const parsed = await simpleParser(message.source);
  return {
    uid: message.uid,
    date: parsed.date || message.internalDate || null,
    subject: parsed.subject || null,
    from: safeAddress(parsed.from?.value),
    to: safeAddress(parsed.to?.value),
    cc: safeAddress(parsed.cc?.value),
    replyTo: safeAddress(parsed.replyTo?.value),
    messageId: parsed.messageId || null,
    inReplyTo: parsed.inReplyTo || null,
    text: parsed.text || '',
    htmlAvailable: Boolean(parsed.html),
    attachments: (parsed.attachments || []).map((attachment) => ({
      filename: attachment.filename || null,
      contentType: attachment.contentType || null,
      size: attachment.size || 0,
    })),
  };
}

const server = new McpServer({
  name: 'tbg-private-email',
  version: '0.1.0',
});

server.registerTool(
  'email_profile',
  {
    description: 'Verify the local Namecheap Private Email IMAP connection and return non-sensitive account metadata.',
    inputSchema: {},
  },
  async () => withClient(async (client) => textResult({
    connected: true,
    provider: 'Namecheap Private Email',
    username: CONFIG.user,
    imapHost: CONFIG.host,
    imapPort: CONFIG.port,
    capabilities: client.capabilities ? [...client.capabilities] : [],
  })),
);

server.registerTool(
  'email_folders',
  {
    description: 'List available mail folders in the connected Namecheap mailbox.',
    inputSchema: {},
  },
  async () => withClient(async (client) => textResult({
    folders: (await client.list()).map((folder) => ({ path: folder.path, name: folder.name, specialUse: folder.specialUse || null })),
  })),
);

server.registerTool(
  'email_search',
  {
    description: 'Search a mailbox by text, sender, recipient, subject, and optional date range. Returns metadata only; use email_read for full content.',
    inputSchema: {
      query: z.string().min(1).describe('Text to search in subject/body/from/to.'),
      folder: z.string().default('INBOX').describe('IMAP folder path.'),
      dateFrom: z.string().optional().describe('Inclusive ISO date, for example 2026-08-01.'),
      dateTo: z.string().optional().describe('Exclusive ISO date, for example 2026-09-01.'),
      limit: z.number().int().min(1).max(100).default(25),
    },
  },
  async ({ query, folder, dateFrom, dateTo, limit }) => withClient(async (client) => withMailbox(client, folder, async () => {
    const criteria = {
      or: [{ subject: query }, { body: query }, { from: query }, { to: query }],
      ...(dateFrom ? { since: new Date(dateFrom) } : {}),
      ...(dateTo ? { before: new Date(dateTo) } : {}),
    };
    const uids = await client.search(criteria, { uid: true });
    const selected = uids.slice(-limit).reverse();
    const rows = [];
    for await (const message of client.fetch(selected, { envelope: true, flags: true, internalDate: true, size: true }, { uid: true })) {
      rows.push({
        uid: message.uid,
        date: message.internalDate || message.envelope?.date || null,
        subject: message.envelope?.subject || null,
        from: safeAddress(message.envelope?.from),
        to: safeAddress(message.envelope?.to),
        flags: message.flags ? [...message.flags] : [],
        size: message.size || 0,
      });
    }
    return textResult({ folder, count: rows.length, results: rows });
  })),
);

server.registerTool(
  'email_read',
  {
    description: 'Read one email by IMAP UID, including plain text and attachment metadata. Do not expose credentials or raw protocol data.',
    inputSchema: {
      uid: z.number().int().positive(),
      folder: z.string().default('INBOX'),
    },
  },
  async ({ uid, folder }) => withClient(async (client) => withMailbox(client, folder, async () => {
    const message = await client.fetchOne(uid, { source: true, envelope: true, flags: true, internalDate: true, size: true }, { uid: true });
    if (!message) throw new Error(`Email UID ${uid} was not found in ${folder}.`);
    return textResult(await parseMessage(message));
  })),
);

server.registerTool(
  'email_recent',
  {
    description: 'Read the newest messages from a mailbox for analysis.',
    inputSchema: {
      folder: z.string().default('INBOX'),
      limit: z.number().int().min(1).max(50).default(10),
    },
  },
  async ({ folder, limit }) => withClient(async (client) => withMailbox(client, folder, async () => {
    const mailbox = client.mailbox;
    const start = Math.max(1, (mailbox?.exists || 0) - limit + 1);
    const rows = [];
    if ((mailbox?.exists || 0) > 0) {
      for await (const message of client.fetch(`${start}:*`, { source: true, envelope: true, flags: true, internalDate: true, size: true })) {
        rows.push(await parseMessage(message));
      }
    }
    return textResult({ folder, count: rows.length, messages: rows.reverse() });
  })),
);

server.registerTool(
  'support_sync',
  {
    description: 'Scan the Namecheap Inbox and Sent folders, filter unrelated mail, and persist accepted support/sales conversations. This does not send email.',
    inputSchema: {},
  },
  async () => textResult({ ok: true, sync: await syncMailbox() }),
);

server.registerTool(
  'support_agent_status',
  {
    description: 'Show whether the hosted inbox agent is running, its latest and next check, filtering counts, and open/escalated queue totals.',
    inputSchema: {},
  },
  async () => textResult(await supportBridgeFetch('/support-bridge/status')),
);

server.registerTool(
  'support_list',
  {
    description: 'List filtered support conversations for an agent. Technical mailbox noise is excluded before it reaches this queue.',
    inputSchema: {
      status: z.enum(['ALL', 'OPEN', 'NEEDS_TRIAGE', 'ESCALATED', 'WAITING_CUSTOMER', 'CLOSED']).default('ALL'),
      limit: z.number().int().min(1).max(100).default(25),
    },
  },
  async ({ status, limit }) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (status !== 'ALL') params.set('status', status);
    return textResult(await supportBridgeFetch(`/support-bridge/conversations?${params}`));
  },
);

server.registerTool(
  'support_get',
  {
    description: 'Read one complete support thread with customer classification, Shopify context, drafts, and tamper-evident evidence history.',
    inputSchema: { conversationId: z.string().uuid() },
  },
  async ({ conversationId }) => textResult(await supportBridgeFetch(`/support-bridge/conversations/${encodeURIComponent(conversationId)}`)),
);

server.registerTool(
  'support_draft',
  {
    description: 'Generate or reuse an AI reply draft for one support conversation. This never sends email.',
    inputSchema: { conversationId: z.string().uuid() },
  },
  async ({ conversationId }) => textResult(await supportBridgeFetch(`/support-bridge/conversations/${encodeURIComponent(conversationId)}/draft`, {
    method: 'POST',
    body: '{}',
  })),
);

server.registerTool(
  'support_approve',
  {
    description: 'Approve an exact reply and queue it for delivery by the hosted Namecheap connector. Requires explicit confirmSend=true and creates an evidence record.',
    inputSchema: {
      draftId: z.string().uuid(),
      replyText: z.string().min(1).max(10000),
      confirmSend: z.literal(true).describe('Must be true. This is the explicit authorization to send the external email.'),
    },
  },
  async ({ draftId, replyText, confirmSend }) => textResult(await supportBridgeFetch(`/support-bridge/drafts/${encodeURIComponent(draftId)}/approve`, {
    method: 'POST',
    body: JSON.stringify({ replyText, confirmSend }),
  })),
);

const transport = new StdioServerTransport();
await server.connect(transport);
