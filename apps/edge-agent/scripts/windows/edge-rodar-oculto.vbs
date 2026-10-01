' Abre o edge-rodar.cmd SEM janela (estilo 0) e sai -- #499.
' E o que a tarefa agendada "ArenaHub Edge" executa no login.
Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & pasta & "\edge-rodar.cmd""", 0, False
