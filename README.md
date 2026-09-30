# BookOS Settings

A native system settings application for the BookOS compositor, designed for Samsung Galaxy Book laptops running BookOS — an Arch-based Linux distribution.

Built with Tauri 2 and vanilla JavaScript. Lightweight, fast, hardware-aware.

[![Version](https://img.shields.io/badge/version-0.4.0-blue?style=flat-square)](https://github.com/Evelynx08/BookOS-Settings/releases)
[![Platform](https://img.shields.io/badge/platform-Arch%20%7C%20Debian%20%7C%20Ubuntu-1793D1?style=flat-square)](#installation)
[![License](https://img.shields.io/badge/license-GPLv3-green?style=flat-square)](LICENSE)

---

## Overview

BookOS Settings is a unified control panel that consolidates hardware-specific controls, system preferences, and appearance options into a single cohesive interface. It configures the BookOS desktop and exposes supported Samsung Galaxy Book hardware controls.

---

## Features

| Category | Capabilities |
|---|---|
| Battery | Performance mode, fan control, adaptive charging, battery protection limit, USB-C charging |
| Display | Brightness, resolution, refresh rate, scale and external displays |
| Sound | Per-app volume, output and input selection, mute, balance and audio profiles, with readable device names («Laptop speakers», «HDMI / DisplayPort 1») instead of the chip's, and without monitor sources or idle system streams |
| Lock screen | Native clock, avatar, media controls, inactivity lock and SDDM editor |
| Themes | BookOS accent, dark and light modes and scheduled switching. With *Automatic BookOS accent* on, the desktop accent follows the wallpaper |
| Wallpaper | Gallery with the BookOS wallpapers first, light/dark pairs applied together, and color palette extraction |
| Connections | Wi-Fi, Bluetooth, VPN, airplane mode |
| Devices | Quick Share (rquickshare), Galaxy Buds |
| Security | UFW firewall control, application permissions |
| Accounts | Username, hostname, avatar |
| General | Language (Spanish and English with auto-detection), keyboard layout, date and time |
| Maintenance | Disk usage, cache cleanup, system logs |
| Desktop | Dock icon size, number of virtual desktops and accent |
| Advanced | BookOS effects, activities and autostart manager |
| Updates | System packages (paru), Flatpak updates |
| Accessibility | Vision aids, magnifier, high contrast |
| About | Hardware information, CPU, RAM, GPU, kernel, BookOS desktop |

### Additional capabilities

- A home page with the live state of the device: its commercial model, the connected network, brightness, sound output and battery.
- The window opens sized to the screen, centred and clear of the panel and the dock.
- Localization in Spanish and English with automatic locale detection. Manual override stored in `localStorage` under `bookos_lang`.
- Granular search that finds both top-level pages and nested settings.
- Animated fingerprint enrollment dialog with stroke draw-in, scan laser sweep, success glow, and error feedback.
- Smooth page transitions on navigation.
- Routines engine for automating combinations of toggles, with snapshot-based undo.
- Bundled systemd units for adaptive charging, thermal logging, and hardware permissions.

---

## Technology

| Layer | Technology |
|---|---|
| Application shell | [Tauri 2](https://tauri.app) — Rust backend with WebView frontend |
| Frontend | Vanilla JavaScript ES modules (no framework) |
| Styling | Plain CSS with custom properties |
| System integration | D-Bus (zbus), sysfs, shell commands |
| Hardware control | `org.bookos.System1`, `org.bookos.Desktop`, `ufw`, sysfs backlight |
| Background services | systemd system and user units |

---

## Installation

### Arch Linux (AUR)

```bash
yay -S bookos-settings
```

The AUR package downloads the pre-built binary from GitHub Releases and installs in seconds without compiling.

### Debian and Ubuntu (APT repository)

```bash
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://evelynx08.github.io/BookOS-Settings/KEY.gpg \
    | sudo tee /etc/apt/keyrings/bookos.asc > /dev/null

echo "deb [signed-by=/etc/apt/keyrings/bookos.asc] https://evelynx08.github.io/BookOS-Settings bookworm main" \
    | sudo tee /etc/apt/sources.list.d/bookos.list

sudo apt update
sudo apt install bookos-settings
```

Compatible with Debian 12 and newer, and Ubuntu 22.04 and newer. The repository is GPG-signed.

### Standalone packages

Download the appropriate file from [Releases](https://github.com/Evelynx08/BookOS-Settings/releases):

| Distribution | File |
|---|---|
| Arch Linux | `bookos-settings-0.4.0-1-x86_64.pkg.tar.zst` |
| Debian / Ubuntu | `Bookos Settings_0.4.0_amd64.deb` |
| Fedora / RHEL | `Bookos Settings-0.4.0-1.x86_64.rpm` |

### Build from source

Required build dependencies:

```bash
sudo pacman -S rust cargo webkit2gtk-4.1 gtk3 libsoup3 protobuf
```

Optional dependencies:

```bash
sudo pacman -S colord inotify-tools python python-dbus python-gobject
```

Clone and build:

```bash
git clone https://github.com/Evelynx08/BookOS-Settings
cd BookOS-Settings
cargo tauri build
```

The compiled binary is at `src-tauri/target/release/bookos-settings`. Distribution bundles are produced in `src-tauri/target/release/bundle/`.

---

## Running

```bash
bookos-settings
```

A `.desktop` entry is installed automatically and the application appears in the BookOS launchpad under Settings.

To launch at login in the background, enable the option inside *General Management → Autostart → Launch at login*.

---

## Project structure

```
BookOS-Settings/
├── src/
│   ├── main.js              Application bootstrap, routing, search logic
│   ├── style.css            Styles and animations
│   ├── index.html
│   ├── assets/              SVG icons
│   └── modules/
│       ├── pages.js         Settings page renderers
│       ├── pages/desktop.js Sound, displays and desktop pages
│       ├── home.js          Sidebar items and search index
│       └── i18n.js          Translations and locale detection
├── src-tauri/
│   ├── src/
│   │   ├── main.rs          Tauri commands and hardware control
│   │   ├── hardware_control.rs
│   │   ├── quickshare.rs    rquickshare integration
│   │   ├── buds.rs          Galaxy Buds via BlueZ
│   │   ├── p2p.rs
│   │   ├── palette.rs       Dynamic palette from the wallpaper
│   │   ├── wallpaper_preview.rs  Cached gallery thumbnails
│   │   ├── bookos_desktop.rs     org.bookos.Desktop client
│   ├── extra/               systemd units, udev rules, shell scripts
│   └── tauri.conf.json
├── scripts/
│   └── publish-apt.sh       APT repository update automation
└── PKGBUILD
```

---

## Wallpaper and accent

The wallpaper and the accent belong to the desktop, and Settings changes them
through `org.bookos.Desktop`:

- **Light/dark pairs.** BookOS wallpapers ship as `Light/purple.png` and
  `Dark/purple_dark.png`, and the desktop gives `fondo_claro` / `fondo_oscuro`
  priority over `fondo`. Choosing one half of a pair writes both, so switching
  theme takes the wallpaper along; a wallpaper without a pair clears them so it
  can show. Reading the current wallpaper uses the one of the theme on screen.
- **Gallery.** It lists the BookOS wallpapers first, from the same folders the
  desktop uses (`/usr/share/wallpapers/BookOS`, or the development checkout),
  one card per pair, then the ones added with «+» and the pictures folders.
  Plasma wallpaper packages are not listed: BookOS does not use Plasma.
- **Automatic accent.** When on, the desktop accent becomes the entry of its
  closed table (blue, indigo, purple, pink, red, orange, yellow, green, teal,
  graphite) closest in hue to the wallpaper, and changes with it. The dynamic
  palette tints BookOS apps; this keeps the desktop in the same colour.

Thumbnails are generated in `~/.cache/bookos-settings` and served through the
asset protocol. Tauri's `**` scope does not match dot-directories, so that
folder is listed explicitly in `tauri.conf.json`.

---

## Testing

```bash
cd src-tauri && cargo test --release     # Rust: palette, accent, wallpaper pairs, previews
node tests/wallpaper-picker.mjs          # gallery logic
node tests/wallpaper-previews.mjs
```

To look at it inside a nested BookOS session without disturbing a running
instance (the app is single-instance through a lock in `$XDG_RUNTIME_DIR`), run
it under the desktop's compositor with its own short runtime directory:

```bash
mkdir -p -m700 /tmp/bks-rt
WAYLAND_DISPLAY=$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY XDG_RUNTIME_DIR=/tmp/bks-rt \
  ../bookos-desktop/target/debug/bookos-comp src-tauri/target/release/bookos-settings
```

Applying a wallpaper or an accent there writes the real
`~/.config/bookos/panel.conf`; back it up first.

---

## Optional services

After installation, enable the bundled systemd services as needed.

Adaptive charging (limits charge to 80% during prolonged AC use):

```bash
sudo systemctl enable --now bookos-battery-adaptive.timer
```

Battery health logger:

```bash
sudo systemctl enable --now bookos-battery-logger.timer
```

Hardware permissions for keyboard backlight and sensor access:

```bash
sudo systemctl enable --now bookos-hw-perms.service
```

---

## Language

The application detects the system locale on startup. To change manually, navigate to *General Management → Application Language* and select Spanish, English, or Auto. The preference is persisted in `localStorage` under `bookos_lang`.

---

## Supported hardware

Primary target hardware:

- Samsung Galaxy Book 5 Pro (Intel Core Ultra)
- Samsung Galaxy Book 4 series

Desktop controls require a BookOS session. Hardware-specific features (fan control, battery protection limit, keyboard backlight) require the Samsung Galaxy Book sysfs interfaces provided by recent Linux kernels.

---

## Requirements

| Requirement | Version |
|---|---|
| Operating system | Arch Linux, Debian 12+, Ubuntu 22.04+ |
| Desktop | BookOS compositor and bookos-system service |
| Linux kernel | 6.x with Samsung sysfs support |
| WebKit2GTK | 4.1 |
| Rust toolchain | stable (build only) |

---

## Contributing

Issues and pull requests are welcome at [github.com/Evelynx08/BookOS-Settings](https://github.com/Evelynx08/BookOS-Settings).

---

## License

Released under the GNU General Public License v3.0. See [LICENSE](LICENSE) for the full text.

Copyright (C) 2026 Jose Reyes (Evelynx08).

## Shared system service

Wi-Fi, Bluetooth and audio use `org.bookos.System1` on the session bus. Build and
install `bookos-system` with the desktop's `session/instalar.sh`; it activates on
demand through D-Bus/systemd. The service needs NetworkManager, BlueZ and a
PulseAudio-compatible server (normally PipeWire with pipewire-pulse), `pactl`,
`wpctl` and `rfkill`. Settings subscribes to state changes; it does not poll these
command-line tools. Bluetooth pairing asks for confirmation or a code in Settings.
Failures are displayed instead of being reported as successful changes.

Appearance, displays, lock screen and activities use `org.bookos.Desktop`.
Keyboard, pointer and desktop-count changes are saved for the next login.
The old desktop-specific control bridges and generic shell-command bridge have
been removed. Unsupported controls are absent from pages and search.
Existing routines using removed display effects report an unsupported action.
Buds, sharing, routines, SDDM, updates and hardware-specific controls remain.
