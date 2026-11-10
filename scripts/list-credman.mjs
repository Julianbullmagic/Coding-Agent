import { execSync } from 'child_process';
import fs from 'fs';

// List ALL Windows generic credentials
const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class CredEnum {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public uint Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CredEnumerate(string filter, int flags, out int count, out IntPtr credentials);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern void CredFree(IntPtr buffer);
}
"@

try {
    $count = 0
    $ptr = [IntPtr]::Zero
    $success = [CredEnum]::CredEnumerate($null, 0, [ref]$count, [ref]$ptr)
    if ($success -and $count -gt 0) {
        $credSize = [System.Runtime.InteropServices.Marshal]::SizeOf([type][CredEnum+CREDENTIAL])
        for ($i = 0; $i -lt $count; $i++) {
            $credPtr = [IntPtr]::Add($ptr, $i * $credSize)
            $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($credPtr, [type][CredEnum+CREDENTIAL])
            if ($cred.Type -eq 1) {
                Write-Output "$($cred.TargetName)"
            }
        }
        [CredEnum]::CredFree($ptr)
    }
} catch {
    Write-Output "ERROR: $($_.Exception.Message)"
}
`;

const tmpPs = `C:/Users/admin/AppData/Local/Temp/cred_list_${Date.now()}.ps1`;
fs.writeFileSync(tmpPs, psScript);

try {
  const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpPs}"`, { 
    encoding: 'utf8',
    timeout: 20000
  }).trim();
  
  const lines = result.split('\n').map(l => l.trim()).filter(l => l);
  console.log(`Found ${lines.length} generic credentials in Windows Credential Manager:`);
  
  // Filter for VS Code / Electron / Chrome related
  const relevant = lines.filter(l => 
    l.toLowerCase().includes('code') || 
    l.toLowerCase().includes('chrome') || 
    l.toLowerCase().includes('electron') ||
    l.toLowerCase().includes('vscode') ||
    l.toLowerCase().includes('coding')
  );
  
  if (relevant.length > 0) {
    console.log('\nRelevant credentials:');
    relevant.forEach(l => console.log('  -', l));
  } else {
    console.log('\nNo VS Code/Chrome/Electron credentials found.');
    console.log('\nAll credentials:');
    lines.forEach(l => console.log('  -', l));
  }
} catch (e) {
  console.error('Error:', e.message?.slice(0, 300));
} finally {
  try { fs.unlinkSync(tmpPs); } catch {}
}
