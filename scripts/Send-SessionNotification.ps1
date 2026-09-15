param(
    [Parameter(Mandatory)][int]$TargetProcessId,
    [Parameter(Mandatory)][ValidateSet('Lock', 'Unlock')][string]$Notification
)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class QueueSessionProbe {
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr FindWindow(string className, string windowName);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr parameter, IntPtr detail, uint flags, uint timeout, out UIntPtr result);
}
'@
$window = [QueueSessionProbe]::FindWindow('PriorityQueueSessionMonitor', "PriorityQueueSessionMonitor-$TargetProcessId")
if ($window -eq [IntPtr]::Zero) { throw 'The test process has no session notification window.' }
$sessionId = (Get-Process -Id $TargetProcessId).SessionId
$parameter = if ($Notification -eq 'Lock') { 7 } else { 8 }
$result = [UIntPtr]::Zero
$sent = [QueueSessionProbe]::SendMessageTimeout($window, 0x02B1, [UIntPtr]$parameter, [IntPtr]$sessionId, 2, 3000, [ref]$result)
if ($sent -eq [IntPtr]::Zero) { throw 'The app did not handle the test notification.' }
Write-Output "Sent $Notification to test process $TargetProcessId only."