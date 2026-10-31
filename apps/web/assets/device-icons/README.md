# Device icons

The icons in this folder come from matomo-icons:

- Source: https://github.com/matomo-org/matomo-icons
- Commit: `fb96bd3a8edc74f196b736d7050f02a01afd24cf` (2026-08-17)
- Copied on: 2026-10-31
- Groups: `os` and `devices` only. Sermo does not use the `brand` and `browsers` icons.

Each file has the name of the short code that the device detector gives: `os/<CODE>` for the
system (`os/UBT.webp` is Ubuntu) and `devices/<type>` for the type of device
(`devices/feature_phone.svg`). The script `scripts/device-icons.ts` writes the files, and it also
writes the list `apps/web/src/lib/device-icon-files.ts`. Do not edit the icons, the list or
`ATTRIBUTION.md` by hand.

## Changes to the source files

- An SVG source file stays an SVG file. The script adds `aria-hidden="true"` to the root element,
  because the icon is a CSS picture and the button around it has the name. It also removes empty
  `<title>` elements and the properties that only drawing programs use (`enable-background`,
  `-inkscape-*`), and it adds a generic font after a named font.
- For a source file in a different format (PNG, JPEG, GIF, ICO), the script uses the PNG file that
  matomo-icons made in its `dist` folder. This PNG file is square and 48 pixels wide. The script
  changes it to a lossless WebP file with sharp.
- The script measures each icon. It writes three lists into `device-icon-files.ts`:
  - The dark icons of one colour that matomo-icons lists in `dark-monochrome-icons.json`. The web
    app shows them in the colour of the text. An icon that fills most of its square (HarmonyOS)
    is not on this list.
  - The other dark icons. The web app gives them a light edge on the dark theme.
  - The icon of each family of systems: the system that the detector gives the same name as the
    family (`Android` is `AND`). The script reads the families from node-device-detector, a
    dependency of `packages/core`. Run the script again after an update of node-device-detector.

## Licences and attribution

The icons do not use the MIT licence of Sermo. They keep the licences of matomo-icons:

- The matomo-icons repository uses the GNU General Public License, version 3. A copy is in
  `LICENSE-GPL-3.0.txt`.
- The `devices` icons are Material icons from Google, under the Apache License, version 2.0. A
  copy is in `LICENSE-APACHE-2.0.txt`. The `feature_phone` icon is an exception: it is from
  Wikimedia Commons (`Maki-mobile-phone-15.svg`), under CC0 1.0.
- Each `os` icon is the logo of its system. The names and logos are trademarks of their owners.
  `ATTRIBUTION.md` gives the source of each icon where matomo-icons names one (its `.source` files).

These licences do not tell you to show a credit line on the site.

## Refresh the icons

1. Clone the repository: `git clone https://github.com/matomo-org/matomo-icons.git <folder>`.
2. Select the commit: `git -C <folder> checkout <commit>`.
3. If you use a new commit, write it in `MATOMO_ICONS.commit` in `scripts/device-icons-lib.ts`.
4. At the root of the Sermo repository, run `bun scripts/device-icons.ts <folder>`.
5. Update the commit and the dates in this file.
6. Do a check of the new device types. Each type in `DEVICE_ICON_FILES` must have a name in
   `forum.deviceIcons.types` of `apps/web/messages/en` and `apps/web/messages/es`. The type
   check of the web app finds a missing name.
