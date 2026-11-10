@echo off
echo.
echo Google Business Profile - Auto Reply to Unanswered Reviews
echo.
echo Make sure you have set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
echo environment variables, or pass them as arguments below.
echo.
node "%~dp0business-reviews-auto-reply.mjs" %*
