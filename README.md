# Luma Image Studio

A private, local browser-based image editor built with TypeScript, React, Vinext/Next.js, Konva, Tailwind CSS, and shadcn components.

All editing, project saving, background images, and compression happen locally on your laptop. Images are not uploaded to a server.

## Features

- Upload or drag multiple images onto the canvas
- Add a supplied image as the canvas background
- Remove a photo background locally with one-click AI subject extraction
- Refine a removed background with erase and restore brushes
- Cancel a long background-removal job without applying its unfinished result
- Crop with draggable freeform boundaries, then move, resize, rotate, and flip layers
- Enter exact width and height values with optional aspect-ratio locking
- Adjust brightness, contrast, saturation, and blur
- Compress large images locally with adjustable WebP quality and maximum dimensions
- Download the selected compressed image as WebP
- Add and edit text, rectangles, and ellipses
- Reorder, hide, duplicate, and delete layers
- Undo and redo individual changes or undo all changes
- Restore an image to its original crop, size, rotation, flips, and adjustments
- Export the completed canvas as PNG, JPEG, or WebP
- Create, rename, duplicate, switch, and delete multiple locally saved projects
- Export and import editable `.luma` project backup files
- Automatically save and restore projects on this device
- Use the layers and adjustment controls from a mobile-sized screen

## Remove and replace a background

1. Upload your portrait or product photo.
2. Select the photo and open **Adjust**.
3. Under **AI background removal**, click **Remove background**.
4. Wait for the subject to become transparent. The first use downloads the compact model and takes longer.
5. Click **Choose background** and select your replacement image.
6. If the cutout needs cleanup, click **Refine edges**. Use **Erase** to remove leftovers or **Restore** to paint back part of the subject, then apply the cleanup.

The removal model runs inside the browser. The first use requires internet access to download model files; the photo itself is processed on your laptop.

## Freeform crop

1. Select an image layer and open **Adjust**.
2. Click **Start freeform crop**.
3. Drag any orange edge or corner on the canvas.
4. Click **Apply crop**. Use **Cancel** to leave the image unchanged.

Set the layer rotation to 0° before starting a freeform crop.

## Projects and backups

Click **Projects** in the top bar to create or switch projects. Projects are automatically saved in this browser. Use **Export current** or **Backup** to download an editable `.luma` file, and **Import .luma** to restore it later or open it on another computer.

Browser storage is not a permanent backup. Export important projects before clearing browser data.

## Requirements

- Windows 10 or newer
- [Git for Windows](https://git-scm.com/download/win), including Git Bash
- [Node.js](https://nodejs.org/) version 22.13 or newer
- pnpm package manager

## First-time setup with Git Bash

Open Git Bash and check Node:

```bash
node --version
npm --version
```

Install pnpm if it is not already installed:

```bash
npm install --global pnpm
pnpm --version
```

Enter the project and install dependencies:

```bash
cd /c/Users/Saqib/Downloads/luma-image-studio-source
pnpm install
```

If pnpm reports ignored build scripts, run:

```bash
pnpm approve-builds
```

Select only `esbuild`, `sharp`, `workerd`, and `protobufjs` with the Spacebar, then press Enter. Some entries may already be approved and therefore not appear. After approval, run:

```bash
pnpm install
```

## Run the app

```bash
cd /c/Users/Saqib/Downloads/luma-image-studio-source
pnpm dev
```

Open the `Local` address printed in Git Bash, usually:

```text
http://localhost:3000
```

Keep Git Bash open while using the editor. Press `Ctrl+C` to stop the server.

## Build a release version

```bash
pnpm build
pnpm start
```

Run the automated editor-model tests:

```bash
pnpm test
```

## Host free on Cloudflare

After pushing the repository to GitHub, open the Cloudflare dashboard and create a **Workers & Pages** application connected to `chsaqib/luma-image-studio`.

Use these build settings:

```text
Build command: pnpm build
Deploy command: pnpm exec wrangler deploy --config dist/server/wrangler.json
Node.js version: 22.13 or newer
```

Cloudflare will install the dependencies, build the Vinext application, and deploy the generated Worker. Each later push to `main` can trigger a new deployment. You can also deploy from Git Bash after logging into Wrangler:

```bash
pnpm exec wrangler login
pnpm deploy
```

## Troubleshooting

### No local address appears

Stop the command with `Ctrl+C`, then run:

```bash
pnpm install
pnpm dev
```

### Port 3000 is already in use

The development server may choose another port. Open the exact `Local` address shown in Git Bash.

### The replacement background is hidden

Select the foreground image, open **Adjust**, and run **Remove background** before choosing the replacement.

### Background removal is slow the first time

The first run downloads and initializes the compact AI model. Later runs reuse the browser cache. Keep the browser tab open while it is working.

### Local project storage is full

Large or numerous images can exceed browser storage. Compress image layers, export the result, and remove unused layers.

## Project structure

```text
app/page.tsx       Editor interface, layer model, compression, and editing behavior
app/globals.css    Editor styling and responsive layout
components/ui/     Reusable interface components
public/            Static files
package.json       Dependencies and run commands
```
