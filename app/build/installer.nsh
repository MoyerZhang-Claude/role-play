; 药汤安装脚本补充：升级与卸载时保留 data 目录（角色、对话、设置都在里面）
!macro customRemoveFiles
  SetOutPath $TEMP
  FindFirst $R8 $R9 "$INSTDIR\*.*"
  yt_loop:
    StrCmp $R9 "" yt_done
    StrCmp $R9 "." yt_next
    StrCmp $R9 ".." yt_next
    StrCmp $R9 "data" yt_next
    IfFileExists "$INSTDIR\$R9\*.*" 0 +3
      RMDir /r "$INSTDIR\$R9"
      Goto yt_next
    Delete "$INSTDIR\$R9"
  yt_next:
    FindNext $R8 $R9
    Goto yt_loop
  yt_done:
  FindClose $R8
  ${ifNot} ${isUpdated}
    IfSilent yt_keep
    IfFileExists "$INSTDIR\data\*.*" 0 yt_keep
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "要同时删除药汤的数据吗？$\r$\n（角色、对话、设置、加密的密钥）$\r$\n$\r$\n选择「否」会保留在：$\r$\n$INSTDIR\data" IDNO yt_keep
    RMDir /r "$INSTDIR\data"
    yt_keep:
  ${endIf}
  RMDir "$INSTDIR"
!macroend
