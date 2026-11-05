' MORU Health Dashboard - silent launcher
' Starts the server in background and opens the browser.
Option Explicit

Dim fso, shell, scriptDir, batPath, port, exec, out, i, ready

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
batPath = scriptDir & "\start-dashboard.bat"
port = "8787"

If Not fso.FileExists(batPath) Then
  MsgBox "start-dashboard.bat not found. Please keep both files together.", 16, "MORU Health Dashboard"
  WScript.Quit 1
End If

Set exec = shell.Exec("cmd /c netstat -ano | findstr LISTENING | findstr :" & port)
out = ""
Do While Not exec.StdOut.AtEndOfStream
  out = out & exec.StdOut.ReadLine()
Loop

If Len(out) > 0 Then
  shell.Run "http://127.0.0.1:" & port, 1, False
  WScript.Quit 0
End If

shell.CurrentDirectory = scriptDir
shell.Run "cmd /c """ & batPath & """", 0, False

ready = False
For i = 1 To 60
  WScript.Sleep 1000
  Set exec = shell.Exec("cmd /c netstat -ano | findstr LISTENING | findstr :" & port)
  out = ""
  Do While Not exec.StdOut.AtEndOfStream
    out = out & exec.StdOut.ReadLine()
  Loop
  If Len(out) > 0 Then
    ready = True
    Exit For
  End If
Next

If ready Then
  shell.Run "http://127.0.0.1:" & port, 1, False
Else
  MsgBox "Server start timed out. Please run start-dashboard.bat to see the error.", 48, "MORU Health Dashboard"
End If
