# Margin as a Mac app

Margin runs in the background as an optimised production build (`next build` + `next start`). It starts by itself when you log in and answers only on your own Mac (`127.0.0.1`). The Margin icon in the Dock opens it in its own window: a Chrome app window with no tabs and no address bar, in its own Chrome profile (`.mac-app/chrome-profile`) with extensions turned off, so nothing from your everyday Chrome (extensions, settings, other tabs) runs inside Margin or slows its scrolling. One more app, **Update Margin**, brings in later changes safely, and one command undoes an update.

Everything these scripts make lives inside the project, in `.mac-app/` (git-ignored). The only files outside the project are the three you copy yourself in the steps below.

## How it fits together

```
login ─► launchd ─► ~/Library/LaunchAgents/com.margin.server.plist
                       └► .mac-app/bin/run-server.sh
                            └► next start -p 3000, inside .mac-app/current ─► your data in .data

Dock: Margin.app ─► .mac-app/bin/open.sh ─► Chrome --user-data-dir=.mac-app/chrome-profile --disable-extensions --app=http://localhost:3000

Update Margin.app ─► .mac-app/bin/update.sh
   1. snapshot the public branch into .mac-app/releases/<date>-<commit> and build it  (the app keeps running)
   2. back up .data to .data-backup-<date>
   3. point .mac-app/current at the new build (the old one becomes .mac-app/previous) and restart
   4. check that it answers; if it doesn't, go back to the previous build on its own
```

- **Builds come from the `public` branch, not from your working folder.** Each update unpacks the branch's latest commit (`git archive public`) into a release folder of its own. Unfinished edits, or another branch checked out in `~/Projects/margin`, never reach the running app, and switching branches can't break it. The scripts the service uses are copied to `.mac-app/bin` for the same reason.
- **Your data stays where it is.** The service sets `MARGIN_DATA_DIR` to `~/Projects/margin/.data`. Without it, a production build would look in `~/Library/Application Support/Margin`. The build itself never reads `.data`: it gets an empty folder (`.mac-app/build-data`), and `next.config.ts` keeps `.data`, its backups and `.mac-app` out of file tracing.
- **Backups are cheap.** `.data-backup-<date>` is an APFS copy-on-write clone, so it takes almost no disk until files change. The database in it comes from SQLite's own online backup, so it is consistent even while Margin is writing. Backups are never deleted by these scripts; remove old ones yourself when you like (see below).
- **Rollback is instant.** The last three builds are kept. `rollback.sh` points `current` back at `previous` and restarts.
- **The port is 3000**, unless something was already listening there when setup ran (it then takes the next free one and saves it in `.mac-app/env.sh`). A later `npm run dev` simply moves to 3001.

## Set it up (once)

Open Terminal and paste each block. Lines starting with `#` are only explanations.

**1. Make the first build and the files to install.** This writes only inside the project. It takes about a minute and ends by printing the same steps as below.

```sh
cd ~/Projects/margin
bash scripts/mac/setup.sh
```

**2. Install the background service.** This copies the service file to where macOS looks for your login items, then starts it right away. From now on it starts at every login, and if it ever stops, macOS starts it again. macOS may show a "Background Items Added" notice; that is this service.

```sh
cp ~/Projects/margin/.mac-app/com.margin.server.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.margin.server.plist
```

**3. Check that it answers.** You should see `Service: loaded` and `Answering: yes, on http://localhost:3000`.

```sh
~/Projects/margin/.mac-app/bin/service.sh status
```

**4. Put the two apps in Applications.** This copies Margin (opens the app) and Update Margin (one-click update).

```sh
cp -R ~/Projects/margin/.mac-app/Margin.app /Applications/
cp -R ~/Projects/margin/.mac-app/"Update Margin.app" /Applications/
```

**5. Add Margin to the Dock.** Open Applications in Finder (`open /Applications`) and drag **Margin** onto your Dock. Click it: Margin opens in its own window. The first time, macOS may ask whether Margin may control Google Chrome or show notifications; allow it.

## Every day

Click **Margin** in the Dock. That's all. If the service wasn't running, the icon starts it and waits a moment.

## Updating after changes

Once new work is committed on the `public` branch:

- **One click:** open **Update Margin** from Applications (or Launchpad, or Spotlight). It works in the background, keeps Margin running while it builds, and tells you when it's done or what went wrong. The log is `~/Projects/margin/.mac-app/logs/update.log`.
- **Or in Terminal**, to watch it work:

  ```sh
  ~/Projects/margin/.mac-app/bin/update.sh
  ```

If `public` hasn't changed since the last build, it says so and stops. Add `--force` to rebuild anyway. If the build fails, nothing changes. If the new build doesn't start, it goes back to the previous one by itself.

## Undo an update (rollback)

```sh
~/Projects/margin/.mac-app/bin/rollback.sh
```

This switches to the previous build and restarts. Run it again to return to the newer one. It doesn't touch your data.

If an update also changed your data in a way you want to undo, put a backup back. Margin asks you to type `yes` first. Your current `.data` is kept as `.data-before-restore-<date>`; nothing is deleted.

```sh
# list the backups
ls -d ~/Projects/margin/.data-backup-*
# restore one (use a name from the list)
~/Projects/margin/.mac-app/bin/restore-data.sh .data-backup-2026-11-16-103000
```

## Stop, start, check

```sh
~/Projects/margin/.mac-app/bin/service.sh stop      # stops it until you start it again or log in next time
~/Projects/margin/.mac-app/bin/service.sh start
~/Projects/margin/.mac-app/bin/service.sh restart
~/Projects/margin/.mac-app/bin/service.sh status    # running? which build? newest backup?
```

To stop it for good without uninstalling the rest, also remove the service file (step 2 of uninstalling).

## Uninstall everything

Your data (`.data`) and backups stay in the project in every case.

```sh
# 1. stop the background service and unload it
launchctl bootout gui/$(id -u)/com.margin.server
# 2. remove the service file, so it doesn't start at login
rm ~/Library/LaunchAgents/com.margin.server.plist
# 3. remove the two apps
rm -rf /Applications/Margin.app "/Applications/Update Margin.app"
# 4. optional: remove the builds, logs and generated files inside the project
rm -rf ~/Projects/margin/.mac-app
```

Then drag the Margin icon off the Dock. To remove old data backups: `rm -rf ~/Projects/margin/.data-backup-<date>` (check the name with `ls -d ~/Projects/margin/.data-backup-*` first).

## When something is off

- **The Dock icon says Margin isn't running.** Run `~/Projects/margin/.mac-app/bin/service.sh status` and read `~/Projects/margin/.mac-app/logs/server.log`.
- **You changed your Node version (nvm).** The service uses the exact Node it was set up with. Run `bash scripts/mac/setup.sh` again, then restart: `~/Projects/margin/.mac-app/bin/service.sh restart`.
- **You re-ran setup and want the new service file.** Unload, copy and load it again:
  `launchctl bootout gui/$(id -u)/com.margin.server; cp ~/Projects/margin/.mac-app/com.margin.server.plist ~/Library/LaunchAgents/; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.margin.server.plist`
- **An update was interrupted** and the next one says one is already running: `rmdir ~/Projects/margin/.mac-app/update.lock`.
- **Tutoring calls fail** but the app opens: the service runs the `claude` CLI recorded in `.mac-app/env.sh`. Check that `claude` still works in Terminal, then re-run setup.

## How it compares with the dev server

Overview scrolling, measured with `scripts/perf-overview.mjs` (demo course, 1440×900, CPU slowed 4x, wheeled from top to bottom through Lenis; throwaway data and the fake engine) on 16 November 2026. The production figure is the median of four runs (all four nearly identical); dev is three runs after a warm-up.

| | Production build | Dev server |
|---|---|---|
| Frames per second | 57.3 | 55.5–56.2 |
| Dropped frames | 20 | 29–33 |
| Frames over 50 ms | 0 | 1 |
| 95th-percentile frame | 16.8 ms | 16.8–33.3 ms |
| Long tasks | 0 | 1 (about 160 ms) |
| Script time on the main thread | 0.42 s | 0.62–0.65 s |

Pages also open without the dev server's first-visit compile. On your real data every section answered in about 2 seconds, measured to network idle.

## For development

- `scripts/mac/` holds the sources: `setup.sh`, `run-server.sh`, `update.sh`, `rollback.sh`, `restore-data.sh`, `service.sh`, `open.sh`, the shared `lib.sh`, and the icon (`icon.mjs` draws it in a running Margin, using the real Bricolage Grotesque; `Margin.icns` is the result).
- `E2E_PROD=1 npx playwright test` runs the e2e flows on a production build instead of the dev server (own port, throwaway data, fake engine).
