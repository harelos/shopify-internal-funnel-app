@echo off
REM ============================================================
REM  NovaHair -> CJ daily sync (Windows Scheduled Task "NovaHairDailyCJSync").
REM
REM  Creating CJ orders is NOT done here any more. Since 2026-09-17 the
REM  Cloudflare Worker (app/cloudflare-pilot, novahair-monitor.ts) is the
REM  only system that places CJ orders. This job used to create them too,
REM  recognised only its own RESCUE- orders, and so re-bought parcels the
REM  Worker had already ordered as AUTO- (17 duplicates on 2026-09-18).
REM
REM  What runs: the cj-sync-worker monitor, which mirrors CJ payment state
REM  and real tracking numbers back into Shopify for every supplier order
REM  (RESCUE-, AUTO-, MANUAL-, BACKFILL-). Never pays.
REM ============================================================
setlocal
set PY=C:\Users\Lenovo\AppData\Local\Programs\Python\Python312\python.exe
set APP=C:\Users\Lenovo\Desktop\Shopify-Internal-Funnel-App\app
set WORKER=C:\Users\Lenovo\Desktop\Shopify-Internal-Funnel-App\cj-sync-worker
set LOGDIR=%APP%\logs
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set LOG=%LOGDIR%\cj_sync_%DATE:/=-%.log
set PYTHONIOENCODING=utf-8

echo ============================================================ >> "%LOG%"
echo [%DATE% %TIME%] starting daily sync (tracking and payment tags only; creation is the Cloudflare Worker's) >> "%LOG%"

cd /d "%WORKER%"

echo --- push CJ payment state and tracking to Shopify --- >> "%LOG%"
"%PY%" monitor_cj_tracking_to_shopify.py --apply >> "%LOG%" 2>&1

echo [%DATE% %TIME%] done >> "%LOG%"
endlocal
