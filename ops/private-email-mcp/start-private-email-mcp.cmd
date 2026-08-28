@echo off
setlocal

for /f "tokens=2,*" %%A in ('reg query HKCU\Environment /v NAMECHEAP_PRIVATE_EMAIL_USER 2^>nul') do set "NAMECHEAP_PRIVATE_EMAIL_USER=%%B"
for /f "tokens=2,*" %%A in ('reg query HKCU\Environment /v NAMECHEAP_PRIVATE_EMAIL_PASSWORD 2^>nul') do set "NAMECHEAP_PRIVATE_EMAIL_PASSWORD=%%B"

if "%NAMECHEAP_PRIVATE_EMAIL_USER%"=="" exit /b 1
if "%NAMECHEAP_PRIVATE_EMAIL_PASSWORD%"=="" exit /b 1

node "%~dp0src\server.mjs"
