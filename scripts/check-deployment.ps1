# Diagnose Gmail tool deployment state.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = 'c:\Users\admin\Documents\coding-agent-extension'

Write-Output '--- VSIX 0.3.5 contents ---'
$vsix = Join-Path $root 'coding-agent-extension-0.3.5.vsix'
$zip = [System.IO.Compression.ZipFile]::OpenRead($vsix)
try {
    foreach ($rel in @('extension/out/src/gmail.js', 'extension/out/src/extension.js')) {
        $entry = $zip.GetEntry($rel)
        if (-not $entry) { Write-Output "$rel : MISSING"; continue }
        $reader = New-Object System.IO.StreamReader($entry.Open())
        $content = $reader.ReadToEnd()
        $reader.Close()
        Write-Output ("{0}: extractCode={1} decodeOnce={2} jsonParseTokens={3}" -f $rel,
            ($content -match 'extractGmailAuthorizationCode'),
            ($content -match 'decodeOnce'),
            ($content -match 'JSON.parse\(stored\)'))
    }
} finally { $zip.Dispose() }

Write-Output ''
Write-Output '--- Installed extensions folder ---'
$dirs = Get-ChildItem -Path "$env:USERPROFILE\.vscode\extensions" -Directory -Filter '*coding-agent*' -ErrorAction SilentlyContinue
if (-not $dirs) { Write-Output 'No coding-agent extension directories found'; exit 0 }
foreach ($dir in $dirs) {
    Write-Output $dir.Name
}

Write-Output ''
Write-Output '--- Installed extension gmail.js signature check ---'
foreach ($dir in $dirs) {
    $g = Join-Path $dir.FullName 'out\src\gmail.js'
    if (Test-Path $g) {
        $c = Get-Content $g -Raw
        Write-Output ("{0}: decodeOnce={1} extractCode={2}" -f $dir.Name,
            ($c -match 'decodeOnce'), ($c -match 'extractGmailAuthorizationCode'))
    } else {
        Write-Output ("{0}: gmail.js not found" -f $dir.Name)
    }
}
