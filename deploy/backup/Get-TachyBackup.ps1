<#
.SYNOPSIS
Downloads encrypted tachy backups from one or more hosts over read-only SFTP.

.DESCRIPTION
Uses only what Windows ships with: sftp.exe (the in-box OpenSSH client) and
Get-FileHash. Connections live in %APPDATA%\tachy\backup-connections.json (see
backup-connections.example.json). Every file is downloaded to a .partial name
and kept only if its SHA-256 matches the .sha256 file published beside it.

A set is the newest database dump plus the newest agent-home and Caddy CA
archives. The files stay encrypted; this script never needs the backup key.

.EXAMPLE
Get-TachyBackup                       # newest set from every connection
Get-TachyBackup -Connection office    # the same, for one connection
Get-TachyBackup -List                 # what the host has, and what is local
Get-TachyBackup -All                  # every file the host has that is missing here
#>
[CmdletBinding()]
param(
    [string]$Connection,
    [switch]$List,
    [switch]$All,
    [string]$ConfigPath = $(Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'tachy/backup-connections.json')
)

$ErrorActionPreference = 'Stop'
$Families = @('tachy-db-', 'tachy-tachy-agent-home-', 'tachy-caddy-data-')

function Expand-Home([string]$Path) {
    if ($Path -and $Path.StartsWith('~')) { return Join-Path $HOME $Path.Substring(1).TrimStart('/', '\') }
    return $Path
}

function Invoke-Sftp($Conn, [string[]]$Commands) {
    $batch = New-TemporaryFile
    try {
        if ($Conn.remoteDir) { $Commands = @("cd `"$($Conn.remoteDir)`"") + $Commands }
        Set-Content -Path $batch -Value $Commands -Encoding ascii
        $sftpArgs = @(
            '-b', $batch.FullName,
            '-P', "$($Conn.port)",
            '-i', (Expand-Home $Conn.identityFile),
            '-o', 'StrictHostKeyChecking=yes',
            '-o', "UserKnownHostsFile=$(Expand-Home $Conn.knownHostsFile)",
            '-o', 'BatchMode=no',
            "$($Conn.user)@$($Conn.host)"
        )
        $out = & sftp @sftpArgs 2>&1
        if ($LASTEXITCODE -ne 0) { throw "sftp to $($Conn.name) failed ($LASTEXITCODE): $($out -join "`n")" }
        return $out
    }
    finally { Remove-Item $batch -Force -ErrorAction SilentlyContinue }
}

function Get-RemoteFiles($Conn) {
    $files = @{}
    foreach ($line in (Invoke-Sftp $Conn @('ls -l'))) {
        $parts = "$line" -split '\s+'
        if ($parts.Count -lt 9 -or -not $parts[0].StartsWith('-')) { continue }
        $name = $parts[-1]
        if ($name -like 'tachy-*.age' -or $name -like 'tachy-*.age.sha256') {
            $files[$name] = [int64]$parts[4]
        }
    }
    return $files
}

function Get-NewestSet($Remote) {
    $set = @()
    foreach ($family in $Families) {
        $newest = $Remote.Keys | Where-Object { $_.StartsWith($family) -and $_.EndsWith('.age') } | Sort-Object -Descending | Select-Object -First 1
        if ($newest) { $set += $newest }
    }
    return $set
}

function Test-LocalCopy([string]$Dest, [string]$Name) {
    $file = Join-Path $Dest $Name
    $sum = "$file.sha256"
    if (-not ((Test-Path $file) -and (Test-Path $sum))) { return $false }
    $want = ((Get-Content $sum -Raw) -split '\s+')[0].ToLowerInvariant()
    return (Get-FileHash -Algorithm SHA256 $file).Hash.ToLowerInvariant() -eq $want
}

function Save-File($Conn, [string]$Dest, [string]$Name, $Remote) {
    $minFree = [int64]$(if ($Conn.minFreeGB) { $Conn.minFreeGB } else { 0 }) * 1GB
    $root = [System.IO.Path]::GetPathRoot((Resolve-Path $Dest).Path)
    $free = ([System.IO.DriveInfo]::new($root)).AvailableFreeSpace
    if ($free - $Remote[$Name] -lt $minFree) {
        throw "not downloading $Name to $Dest`: it would leave less than $($Conn.minFreeGB) GB free"
    }

    $file = Join-Path $Dest $Name
    $partial = "$file.partial"
    $sumPartial = "$file.sha256.partial"
    Remove-Item $partial, $sumPartial -Force -ErrorAction SilentlyContinue
    # sftp's batch parser reads a backslash as an escape; Windows accepts '/'.
    $to = $partial -replace '\\', '/'
    $sumTo = $sumPartial -replace '\\', '/'
    Invoke-Sftp $Conn @("get `"$Name`" `"$to`"", "get `"$Name.sha256`" `"$sumTo`"") | Out-Null

    $want = ((Get-Content $sumPartial -Raw) -split '\s+')[0].ToLowerInvariant()
    $got = (Get-FileHash -Algorithm SHA256 $partial).Hash.ToLowerInvariant()
    if ($got -ne $want) {
        Remove-Item $partial, $sumPartial -Force
        throw "$Name from $($Conn.name) failed its checksum; the partial download was removed"
    }
    Move-Item $partial $file -Force
    Move-Item $sumPartial "$file.sha256" -Force
    Add-Content -Path (Join-Path $Dest 'pulled.log') -Value "$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')) $($Conn.name) $Name $got"
    Write-Host "  saved $Name"
}

function Remove-OldSets($Conn, [string]$Dest) {
    $keep = [int]$(if ($Conn.keepSets) { $Conn.keepSets } else { 10 })
    foreach ($family in $Families) {
        $local = Get-ChildItem -Path $Dest -Filter "$family*.age" | Sort-Object Name -Descending
        foreach ($old in ($local | Select-Object -Skip $keep)) {
            Remove-Item $old.FullName, "$($old.FullName).sha256" -Force -ErrorAction SilentlyContinue
            Write-Host "  removed old $($old.Name)"
        }
    }
}

if (-not (Test-Path $ConfigPath)) { throw "no connections file at $ConfigPath (copy backup-connections.example.json there)" }
$connections = (Get-Content $ConfigPath -Raw | ConvertFrom-Json).connections
if ($Connection) { $connections = @($connections | Where-Object name -eq $Connection) }
if (-not $connections) { throw "no connection named '$Connection' in $ConfigPath" }

$failed = $false
foreach ($conn in $connections) {
    if (-not $conn.port) { $conn | Add-Member port 22 -Force }
    $dest = Expand-Home $conn.destination
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Write-Host "$($conn.name) ($($conn.user)@$($conn.host))"
    try {
        $remote = Get-RemoteFiles $conn
        $names = $remote.Keys | Where-Object { $_.EndsWith('.age') } | Sort-Object -Descending

        if ($List) {
            foreach ($n in $names) {
                $state = if (Test-LocalCopy $dest $n) { 'local' } else { '     ' }
                Write-Host ("  {0}  {1,10:N0} KB  {2}" -f $state, ($remote[$n] / 1KB), $n)
            }
            continue
        }

        $wanted = if ($All) { $names } else { Get-NewestSet $remote }
        foreach ($name in $wanted) {
            if (-not $remote.ContainsKey("$name.sha256")) { Write-Warning "  $name has no checksum on the host yet; skipped"; continue }
            if (Test-LocalCopy $dest $name) { Write-Host "  have $name"; continue }
            Save-File $conn $dest $name $remote
        }
        Remove-OldSets $conn $dest
    }
    catch {
        Write-Error "$($conn.name): $_" -ErrorAction Continue
        $failed = $true
    }
}
if ($failed) { exit 1 }
