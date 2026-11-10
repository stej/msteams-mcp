param(
    [Parameter(Mandatory)]
    [ValidateSet('Protect', 'Unprotect', 'SecureDirectory', 'AssertLocalPath')]
    [string] $Operation
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

try {
    $inputBytes = [Convert]::FromBase64String([Console]::In.ReadToEnd())

    if ($Operation -eq 'Protect' -or $Operation -eq 'Unprotect') {
        Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
        $entropy = [Text.Encoding]::UTF8.GetBytes('msteams-mcp.session.v2')
        $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
        if ($Operation -eq 'Protect') {
            $outputBytes = [Security.Cryptography.ProtectedData]::Protect($inputBytes, $entropy, $scope)
        }
        else {
            $outputBytes = [Security.Cryptography.ProtectedData]::Unprotect($inputBytes, $entropy, $scope)
        }
        [Console]::Out.Write([Convert]::ToBase64String($outputBytes))
        exit 0
    }

    $path = [Text.Encoding]::UTF8.GetString($inputBytes)
    if ($path -notmatch '^[A-Za-z]:\\' -or $path.Substring(2) -match ':') {
        throw 'A local drive path is required.'
    }

    Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public static class LocalDrive {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    public static extern uint GetDriveType(string rootPath);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern uint GetFileAttributes(string path);
}
"@

    $fullPath = [IO.Path]::GetFullPath($path)
    if ([LocalDrive]::GetDriveType([IO.Path]::GetPathRoot($fullPath)) -ne 3) {
        throw 'A fixed local drive is required.'
    }

    # Walk from the drive root down. Never inspect a child through an unchecked
    # parent junction: even File.Exists on that child could contact a remote share.
    $cursor = [IO.Path]::GetPathRoot($fullPath)
    $parts = $fullPath.Substring($cursor.Length).Split('\', [StringSplitOptions]::RemoveEmptyEntries)
    foreach ($part in $parts) {
        $cursor = [IO.Path]::Combine($cursor, $part)
        $attributes = [LocalDrive]::GetFileAttributes($cursor)
        if ($attributes -eq [uint32]::MaxValue) {
            $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
            if ($errorCode -eq 2 -or $errorCode -eq 3) { break }
            throw 'Cannot verify the local path.'
        }
        if (($attributes -band 0x400) -ne 0) {
            throw 'Reparse points are not allowed.'
        }
    }

    if ($Operation -eq 'SecureDirectory') {
        $directory = [IO.Directory]::CreateDirectory($fullPath)
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl = [Security.AccessControl.DirectorySecurity]::new()
        $acl.SetOwner($identity)
        $acl.SetAccessRuleProtection($true, $false)
        $inheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
        $propagation = [Security.AccessControl.PropagationFlags]::None
        $allow = [Security.AccessControl.AccessControlType]::Allow
        foreach ($sid in @($identity, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
            $rule = [Security.AccessControl.FileSystemAccessRule]::new(
                $sid, [Security.AccessControl.FileSystemRights]::FullControl,
                $inheritance, $propagation, $allow
            )
            $acl.AddAccessRule($rule)
        }
        [IO.FileSystemAclExtensions]::SetAccessControl($directory, $acl)
    }
}
catch {
    [Console]::Error.Write('Windows protection failed.')
    exit 1
}
