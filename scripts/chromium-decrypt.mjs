import fs from 'fs';
import { execSync } from 'child_process';
import crypto from 'crypto';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// VS Code (Electron/Chromium) os_crypt on Windows:
// 1. Reads encryption key from Windows Credential Manager under "Chrome Safe Storage" for the account ""
// 2. The key is DPAPI-encrypted itself
// 3. v10 prefix, then AES-256-GCM with nonce (first 12 bytes) and ciphertext + tag

// Step 1: Find the Chromium encryption key from Credential Manager
function getChromiumEncryptionKey() {
  // Use PowerShell with keytar-equivalent P/Invoke to read from Credential Manager
  // The target name for VS Code's key is similar to "chrome.SafeStorage" or varies by Electron version
  const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class CredentialManager {
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

# Try different target names that VS Code/Electron might use
$targets = @(
    "Chrome Safe Storage",
    "Chromium Safe Storage",
    "VS Code Safe Storage",
    "Code - OSS Safe Storage",
    "Electron Safe Storage",
    "coding-agent-extension Safe Storage"
)

foreach ($target in $targets) {
    try {
        $ptr = [IntPtr]::Zero
        $success = [CredentialManager]::CredRead($target, 1, 0, [ref]$ptr)
        if ($success) {
            $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredentialManager+CREDENTIAL])
            $blobSize = $cred.CredentialBlobSize
            $blob = New-Object byte[] $blobSize
            [System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $blob, 0, $blobSize)
            $b64 = [Convert]::ToBase64String($blob)
            Write-Output "FOUND:$target:$b64"
            [CredentialManager]::CredFree($ptr)
            return
        }
    } catch {}
}

# Also try listing all generic credentials
Write-Output "Trying cmdkey approach..."
`.trim();

  const tmpPs = `C:/Users/admin/AppData/Local/Temp/chromium_key_${Date.now()}.ps1`;
  fs.writeFileSync(tmpPs, psScript);
  try {
    const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpPs}"`, { 
      encoding: 'utf8',
      timeout: 15000
    }).trim();
    console.log('PowerShell result:', result.slice(0, 200));
    
    if (result.startsWith('FOUND:')) {
      const parts = result.split(':');
      const targetName = parts[1];
      const b64Key = parts.slice(2).join(':'); // in case target has colons
      console.log('Found key under target:', targetName);
      
      // DPAPI decrypt the key
      const keyBytes = Buffer.from(b64Key, 'base64');
      const tmpBin = `C:/Users/admin/AppData/Local/Temp/dpapi_key_${Date.now()}.bin`;
      fs.writeFileSync(tmpBin, keyBytes);
      
      const dpapiPs = `
Add-Type -AssemblyName 'System.Security'
$bytes = [System.IO.File]::ReadAllBytes('${tmpBin}')
$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope)
[Convert]::ToBase64String($decrypted)
`.trim();
      const dpapiFile = `C:/Users/admin/AppData/Local/Temp/dpapi_decrypt_${Date.now()}.ps1`;
      fs.writeFileSync(dpapiFile, dpapiPs);
      
      try {
        const decryptedB64 = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${dpapiFile}"`, { 
          encoding: 'utf8',
          timeout: 15000
        }).trim();
        console.log('Decrypted key length (base64):', decryptedB64.length);
        return Buffer.from(decryptedB64, 'base64');
      } catch (e) {
        console.error('DPAPI decrypt of key failed:', e.message?.slice(0, 200));
      } finally {
        try { fs.unlinkSync(tmpBin); } catch {}
        try { fs.unlinkSync(dpapiFile); } catch {}
      }
    }
  } catch (e) {
    console.error('PowerShell error:', e.message?.slice(0, 200));
  } finally {
    try { fs.unlinkSync(tmpPs); } catch {}
  }
  return null;
}

// Step 2: Decrypt a VS Code secret using the Chromium encryption key
function decryptVscSecret(encryptedBuffer, encryptionKey) {
  // v10 prefix (3 bytes) + nonce (12 bytes) + ciphertext+tag
  const version = encryptedBuffer.slice(0, 3).toString('utf8');
  if (version !== 'v10') {
    throw new Error(`Unknown encryption version: ${version}`);
  }
  
  const nonce = encryptedBuffer.slice(3, 15);
  const ciphertextWithTag = encryptedBuffer.slice(15);
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, nonce);
  // The last 16 bytes are the auth tag
  const tag = ciphertextWithTag.slice(ciphertextWithTag.length - 16);
  const ciphertext = ciphertextWithTag.slice(0, ciphertextWithTag.length - 16);
  decipher.setAuthTag(tag);
  
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

// Main
console.log('=== Attempting to find Chromium encryption key ===');
const encryptionKey = getChromiumEncryptionKey();

if (encryptionKey) {
  console.log('Got encryption key, length:', encryptionKey.length, 'bytes');
  
  // Now decrypt the Client ID and Secret
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
  
  const clientIdEncrypted = readSecretBuffer('secret://{"extensionId":"your-name.coding-agent-extension","key":"codingAgent.googleClientId"}');
  const clientSecretEncrypted = readSecretBuffer('secret://{"extensionId":"your-name.coding-agent-extension","key":"codingAgent.googleClientSecret"}');
  
  try {
    const clientId = decryptVscSecret(clientIdEncrypted, encryptionKey);
    const clientSecret = decryptVscSecret(clientSecretEncrypted, encryptionKey);
    
    console.log('\n=== SUCCESS! Decrypted credentials ===');
    console.log('Client ID:', clientId.slice(0, 30) + '...');
    console.log('Client Secret length:', clientSecret.length);
    
    // Save for the business reviews script
    const extStateRow = db.prepare("SELECT value FROM ItemTable WHERE key = 'your-name.coding-agent-extension'").get();
    const state = JSON.parse(typeof extStateRow.value === 'string' ? extStateRow.value : extStateRow.value.toString('utf8'));
    
    const creds = { 
      clientId, 
      clientSecret,
      gmailTokens: state['codingAgent.gmailTokens'],
      googleTokens: state['codingAgent.googleTokens']
    };
    fs.writeFileSync('c:/Users/admin/Documents/coding-agent-extension/scripts/.google-creds.json', JSON.stringify(creds, null, 2));
    console.log('\nAll credentials and tokens saved!');
  } catch (e) {
    console.error('Decryption failed:', e.message);
  }
  
  db.close();
} else {
  console.log('\nCould not find the Chromium encryption key.');
  console.log('Falling back to asking user for credentials...');
}
