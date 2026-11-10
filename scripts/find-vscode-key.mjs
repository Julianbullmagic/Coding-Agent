import fs from 'fs';
import { execSync } from 'child_process';
import crypto from 'crypto';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Step 1: Find the Chromium encryption key from Credential Manager
// Using keytar npm package if available, otherwise PowerShell with proper escaping

async function main() {
  // Try keytar first
  let encryptionKey = null;
  try {
    const keytar = require('keytar');
    // VS Code/Electron on Windows stores the key under "Chrome Safe Storage"
    const possibleServices = [
      'Chrome Safe Storage',
      'Chromium Safe Storage', 
      'VS Code Safe Storage',
      'Code - OSS Safe Storage',
    ];
    
    for (const service of possibleServices) {
      try {
        const password = await keytar.getPassword(service, '');
        if (password) {
          console.log(`Found key via keytar under "${service}"`);
          // keytar returns the password as a string, but it's actually binary data
          // On Windows, Credential Manager stores it as a blob
          // The password from keytar is the raw string of the DPAPI-encrypted bytes
          // We need to convert it back to bytes and DPAPI decrypt
          
          // Actually keytar returns the raw bytes as a string which isn't quite right
          // Let's just get the raw bytes via PowerShell instead
          break;
        }
      } catch (e) {
        // Service not found, try next
      }
    }
  } catch (e) {
    console.log('keytar not available, using PowerShell');
  }

  // PowerShell approach - write the ENTIRE script to a file to avoid escaping issues
  const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class CredHelper {
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
    public static extern bool CredRead(string targetName, int type, int flags, out IntPtr credential);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern void CredFree(IntPtr credential);
}
"@

Add-Type -AssemblyName 'System.Security'

$targets = @(
    "Chrome Safe Storage",
    "Chromium Safe Storage",
    "VS Code Safe Storage",
    "Code - OSS Safe Storage",
    "Electron Safe Storage"
)

foreach ($t in $targets) {
    try {
        $ptr = [IntPtr]::Zero
        $success = [CredHelper]::CredRead($t, 1, 0, [ref]$ptr)
        if ($success) {
            $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredHelper+CREDENTIAL])
            $blobSize = $cred.CredentialBlobSize
            $blob = New-Object byte[] $blobSize
            [System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $blob, 0, $blobSize)
            
            # DPAPI decrypt
            $scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
            $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($blob, $null, $scope)
            $b64 = [Convert]::ToBase64String($decrypted)
            Write-Output "FOUND"
            Write-Output $b64
            [CredHelper]::CredFree($ptr)
            exit 0
        }
    } catch {
        # Try next
    }
}

Write-Output "NOT_FOUND"
`;

  const tmpPs = `C:/Users/admin/AppData/Local/Temp/vscode_key_${Date.now()}.ps1`;
  fs.writeFileSync(tmpPs, psScript);
  
  try {
    const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpPs}"`, { 
      encoding: 'utf8',
      timeout: 20000
    }).trim();
    
    const lines = result.split('\n').map(l => l.trim()).filter(l => l);
    console.log('PowerShell output lines:', lines.length);
    
    if (lines[0] === 'FOUND' && lines[1]) {
      encryptionKey = Buffer.from(lines[1], 'base64');
      console.log('Got encryption key, length:', encryptionKey.length, 'bytes');
    } else {
      console.log('Result:', result.slice(0, 100));
    }
  } catch (e) {
    console.error('PowerShell error:', e.message?.slice(0, 300));
  } finally {
    try { fs.unlinkSync(tmpPs); } catch {}
  }

  if (!encryptionKey) {
    console.log('\nCould not find encryption key from Credential Manager.');
    console.log('Trying alternative: searching for the key in VS Code\'s Local Storage...');
    
    // On some Electron versions, the key might be in the LocalAppData
    const localAppData = process.env.LOCALAPPDATA || 'C:/Users/admin/AppData/Local';
    const possiblePaths = [
      `${localAppData}/Programs/Microsoft VS Code`,
      `${localAppData}/Programs/VS Code`,
    ];
    console.log('Checking paths:', possiblePaths);
    return;
  }

  // Step 2: Decrypt the secrets
  console.log('\n=== Decrypting VS Code secrets ===');
  
  const dbPath = 'C:/Users/admin/AppData/Roaming/Code/User/globalStorage/state.vscdb';
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  
  function readSecretBuffer(key) {
    const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(key);
    if (!row) return null;
    const val = row.value;
    const str = typeof val === 'string' ? val : val.toString('utf8');
    try {
      const parsed = JSON.parse(str);
      if (parsed.type === 'Buffer' && Array.isArray(parsed.data)) {
        return Buffer.from(parsed.data);
      }
      return Buffer.from(str, 'utf8');
    } catch {
      return Buffer.from(str, 'utf8');
    }
  }
  
  function decryptVscSecret(encryptedBuffer, key) {
    const version = encryptedBuffer.slice(0, 3).toString('utf8');
    if (version !== 'v10') {
      throw new Error(`Unknown encryption version: ${version}`);
    }
    const nonce = encryptedBuffer.slice(3, 15);
    const ciphertextWithTag = encryptedBuffer.slice(15);
    const tag = ciphertextWithTag.slice(ciphertextWithTag.length - 16);
    const ciphertext = ciphertextWithTag.slice(0, ciphertextWithTag.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
  
  const clientIdEncrypted = readSecretBuffer('secret://{"extensionId":"your-name.coding-agent-extension","key":"codingAgent.googleClientId"}');
  const clientSecretEncrypted = readSecretBuffer('secret://{"extensionId":"your-name.coding-agent-extension","key":"codingAgent.googleClientSecret"}');
  
  try {
    const clientId = decryptVscSecret(clientIdEncrypted, encryptionKey);
    const clientSecret = decryptVscSecret(clientSecretEncrypted, encryptionKey);
    
    console.log('Client ID:', clientId.slice(0, 30) + '...');
    console.log('Client Secret length:', clientSecret.length);
    
    // Also read tokens from globalState
    const extStateRow = db.prepare("SELECT value FROM ItemTable WHERE key = 'your-name.coding-agent-extension'").get();
    const state = JSON.parse(typeof extStateRow.value === 'string' ? extStateRow.value : extStateRow.value.toString('utf8'));
    
    const creds = { 
      clientId, 
      clientSecret,
      gmailTokens: state['codingAgent.gmailTokens'],
      googleTokens: state['codingAgent.googleTokens']
    };
    fs.writeFileSync('c:/Users/admin/Documents/coding-agent-extension/scripts/.google-creds.json', JSON.stringify(creds, null, 2));
    console.log('\nCredentials saved to scripts/.google-creds.json');
  } catch (e) {
    console.error('Decryption failed:', e.message);
  }
  
  db.close();
}

main().catch(console.error);
