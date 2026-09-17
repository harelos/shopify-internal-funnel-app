import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const launcher = "C:\\Users\\Lenovo\\Desktop\\Shopify-Internal-Funnel-App\\ops\\private-email-mcp\\start-private-email-mcp.cmd";
const [command, ...args] = process.argv.slice(2);

const commands = {
  sync: () => ({ name: "support_sync", arguments: {} }),
  status: () => ({ name: "support_agent_status", arguments: {} }),
  list: () => ({
    name: "support_list",
    arguments: { status: args[0] || "ALL", limit: Number(args[1] || 25) },
  }),
  brief: () => ({ name: "support_brief", arguments: { conversationId: args[0] } }),
  draft: () => ({ name: "support_draft", arguments: { conversationId: args[0] } }),
  approve: () => ({
    name: "support_approve",
    arguments: {
      draftId: args[0],
      replyText: Buffer.from(args[1] || "", "base64").toString("utf8"),
      confirmSend: true,
    },
  }),
};

if (!command || !commands[command]) {
  console.error("Usage: codex-support-cli.mjs <sync|status|list|brief|draft|approve> [...args]");
  process.exit(2);
}

const client = new Client({ name: "codex-support-cli", version: "1.0.0" });
const transport = new StdioClientTransport({ command: launcher, args: [] });

try {
  await client.connect(transport);
  const result = await client.callTool(commands[command]());
  const text = (result.content || [])
    .filter(item => item.type === "text")
    .map(item => item.text)
    .join("\n");
  if (result.isError) {
    console.error(text || "Support tool failed.");
    process.exitCode = 1;
  } else {
    console.log(text || JSON.stringify(result));
  }
} finally {
  await client.close();
}
