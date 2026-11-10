Add-Type -AssemblyName System.IO.Compression.FileSystem
$vsix = 'c:\Users\admin\Documents\coding-agent-extension\coding-agent-extension-0.3.5.vsix'
$zip = [System.IO.Compression.ZipFile]::OpenRead($vsix)
try {
    $entry = $zip.GetEntry('extension/out/src/gmail.js')
    if (-not $entry) { Write-Output "0.3.5: NO gmail.js"; return }
    $reader = New-Object System.IO.StreamReader($entry.Open())
    $content = $reader.ReadToEnd()
    $reader.Close()
    Write-Output ("0.3.5 gmail.js : extractCode={0} decodeOnce={1}" -f ($content -match 'extractGmailAuthorizationCode'), ($content -match 'decodeOnce'))
} finally { $zip.Dispose() }

# Compare installed extension against workspace build
$installed = 'c:\Users\admin\.vscode\extensions'
$candidates = Get-ChildItem $installed -Directory -Filter '*coding-agent*'
foreach ($dir in $candidates) {
    Write-Output "Installed extension dir: $($dir.FullName)"
    $installedGmail = Join-Path $dir.FullName 'out\src\gmail.js'
    if (Test-Path $installedGmail) {
        $a = (Get-FileHash $installedGmail).Hash
        $b = (Get-FileHash 'c:\Users\admin\Documents\coding-agent-extension\out\src\gmail.js').Hash
        if ($a -eq $b) { Write-Output 'gmail.js: INSTALLED MATCHES workspace build' }
        else { Write-Output 'gmail.js: INSTALLED DIFFERS from workspace build!' }
        $installedExt = Join-Path $dir.FullName 'out\src\extension.js'
        $c = (Get-FileHash $installedExt).Hash
        $d = (Get-FileHash 'c:\Users\admin\Documents\coding-agent-extension\out\src\extension.js').Hash
        if ($c -eq $d) { Write-Output 'extension.js: INSTALLED MATCHES workspace build' }
        else { Write-Output 'extension.js: INSTALLED DIFFERS from workspace build!' }
    } else {
        Write-Output "No gmail.js found in installed extension!"
    }
}
