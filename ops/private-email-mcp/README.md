# TBG Private Email MCP

Local, read-only MCP server for Namecheap Private Email. It uses IMAP over TLS
and exposes only mailbox inspection tools to Codex:

- `email_profile`
- `email_folders`
- `email_search`
- `email_read`
- `email_recent`

The server never stores credentials in the repository and does not expose send,
delete, archive, or bulk-modification tools. Those can be added later behind an
explicit approval workflow if needed.

## Local credentials

Set these as user-level Windows environment variables, preferably using a
revocable Namecheap App Password:

```powershell
setx NAMECHEAP_PRIVATE_EMAIL_USER "support@tigerbrandsglobal.com"
setx NAMECHEAP_PRIVATE_EMAIL_PASSWORD "<revocable-app-password>"
```

The server uses `mail.privateemail.com:993` with SSL/TLS by default.

## Run locally

```powershell
npm install
npm start
```

The process speaks MCP over stdio and is intended to be started by Codex. The
Windows wrapper reads the user-level environment variables at process start so
the Codex config never contains the mailbox password.
