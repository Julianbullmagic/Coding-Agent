# Verify the installed 0.3.6 extension contains the Gmail metadata fix.
$f = Join-Path $env:USERPROFILE '.vscode\extensions\your-name.coding-agent-extension-0.3.6\out\src\gmail.js'
$c = Get-Content $f -Raw
Write-Output ('fetchMessageMetadata=' + ($c -match 'fetchMessageMetadata'))
Write-Output ('hardcodedSnippet=' + ($c -match [regex]::Escape("snippet: ''")))
Write-Output ('findGmailHeader=' + ($c -match 'findGmailHeader'))
