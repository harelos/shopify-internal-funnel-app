@echo off
setlocal

for /f "tokens=2,*" %%A in ('reg query HKCU\Environment /v NAMECHEAP_PRIVATE_EMAIL_USER 2^>nul') do set "NAMECHEAP_PRIVATE_EMAIL_USER=%%B"
for /f "tokens=2,*" %%A in ('reg query HKCU\Environment /v NAMECHEAP_PRIVATE_EMAIL_PASSWORD 2^>nul') do set "NAMECHEAP_PRIVATE_EMAIL_PASSWORD=%%B"
for /f "tokens=2,*" %%A in ('reg query HKCU\Environment /v SUPPORT_APP_URL 2^>nul') do set "SUPPORT_APP_URL=%%B"
for /f "tokens=2,*" %%A in ('reg query HKCU\Environment /v SUPPORT_CONNECTOR_TOKEN 2^>nul') do set "SUPPORT_CONNECTOR_TOKEN=%%B"
for /f "tokens=2,*" %%A in ('reg query HKCU\Environment /v SUPPORT_MAIL_SEND_ENABLED 2^>nul') do set "SUPPORT_MAIL_SEND_ENABLED=%%B"

if "%NAMECHEAP_PRIVATE_EMAIL_USER%"=="" exit /b 1
if "%NAMECHEAP_PRIVATE_EMAIL_PASSWORD%"=="" exit /b 1
if "%SUPPORT_APP_URL%"=="" exit /b 1
if "%SUPPORT_CONNECTOR_TOKEN%"=="" exit /b 1

rem Run the canonical MCP implementation from the Funnel Builder workspace.
rem It includes both the Namecheap email tools and the approval-gated support
rem tools (support_sync/list/brief/draft). Keeping one source prevents the
rem desktop connector from silently lagging behind the deployed API.
set "CANONICAL_MCP_ROOT=C:\Users\Lenovo\Documents\Codex\2026-08-27\s\work\funnel-builder-gallery-antiflicker\ops\private-email-mcp"
node "%CANONICAL_MCP_ROOT%\src\server.mjs"
