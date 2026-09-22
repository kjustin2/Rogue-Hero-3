# Lost Fiend Windows installer

Build with `npm run dist` from game/. The NSIS include is source, outside ignored
build output. Keep application ID, save paths and origin stable when branding changes.

`installer.nsh` selects the installed executable for setup's post-install launch.
Electron-builder otherwise selects the new Start Menu .lnk. On the inspected Windows
11 machine, its StdUtils shell-as-user handoff reported that existing shortcut missing,
while launching the same shortcut normally worked. The executable handoff fixed setup's
Finish action. Keep StdUtils's unelevated-user launch and ordinary shortcuts intact.

September 8 manual evidence for the predecessor build: current-user install into an isolated custom directory;
correct name/icon; desktop and Start Menu targets resolved to the installed executable;
normal shortcut launch reached the title screen; same-version reinstall retained the
chosen directory; corrected Finish launched the title screen directly. Installed ASAR
matched packaged ASAR. Legacy `%APPDATA%/Rogue Hero 3` storage was created and retained.
Owned temporary installation, shortcuts and uninstall registration were removed using
the shipped uninstaller; game data was preserved. No old production save existed here,
so this is not evidence of upgrading a real pre-overhaul installed save.

The installer remains unsigned and uses standard native NSIS page decoration. No
new automated installer suite was added. Keep the single 30-second game smoke.
