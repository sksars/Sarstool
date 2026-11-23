# FlyAI Tools — All-in-One Online Utility Platform

FlyAI Tools is a fast, mobile-first, privacy-focused online utility platform built with **HTML5, CSS3, and Vanilla JavaScript** (no TypeScript/TSX). Almost all file processing runs directly in your browser using Canvas 2D, Web Audio API, and Web Workers so user files never leave their device.

## Key Features

- **Photo Editing Tools (13)**: AI Background Remover (Web Worker edge-aware segmentation + manual erase/restore brush), Background Changer, Full Photo Editor, Image Cropper, Image Resizer, Image Compressor, Photo Enhancer, HD Image Converter, Passport Size Photo Maker (with printable 4x6 and A4 sheets), Image Blur & Filters, Format Converter (JPG/PNG/WEBP), Image to PDF, and Multiple Image Batch Processor (ZIP export).
- **QR Code Generator**: Text, URL, WiFi, Contact (vCard 3.0), Email, Phone QR with custom colors, error correction, logo overlay, and PNG / JPG / SVG export.
- **Barcode Generator**: Code 128, Code 39, EAN-13, UPC-A, ISBN, and Custom Barcodes with check-digit calculation and PNG / SVG / PDF export.
- **File Converter (14)**: JPG ↔ PNG, WEBP → JPG, JPG → PDF, PDF → JPG/PNG (with ZIP export), DOCX → PDF, TXT → PDF, MP4/WAV → MP3, MP3 → WAV, ZIP Extractor, File Compressor (.zip), and Magic-Byte File Format Detector + SHA-256 Hasher.
- **Link to File Tools**: Inspect and download direct Image, Video, and Audio URLs with size/MIME inspection, plus URL/HTML to PDF conversion.
- **Audio & Video Tools (9)**: Video to MP3, Audio Converter (WAV/MP3/OGG), Audio Cutter with waveform preview, Video Compressor, Video Resizer, Video to GIF (Web Worker GIF89a LZW encoder), Audio Trimmer with fade in/out, Video Thumbnail Generator grid, and Binary Media Metadata Viewer.
- **YouTube Search & Video Tools**: Official YouTube Data API v3 search (videos, channels, playlists, Creative Commons filter, durations, embedded player, search suggestions, local favorites) plus keyless oEmbed Video Inspector.
- **PWA & UX**: Installable Progressive Web App (`manifest.webmanifest` + `sw.js`), Light & Dark theme toggle, Global search (`/` or `Ctrl+K`), Favorites, Recently Used, Local Download History, AdSense-ready layout + `ads.txt`, SEO (`sitemap.xml`, `robots.txt`, JSON-LD), and optional Firebase Auth/Analytics hooks.

## Project Structure

```text
├── index.html                  # Main entry, SEO meta, JSON-LD, responsive shell
├── style.css                   # Light/Dark themes, mobile-first responsive CSS3
├── script.js                   # App router, search, favorites, history, PWA install
├── manifest.webmanifest        # PWA manifest
├── sw.js                       # Offline Service Worker
├── ads.txt                     # Google AdSense publisher declaration
├── robots.txt                  # Search engine crawl rules
├── sitemap.xml                 # XML sitemap
├── firebase.json               # Firebase Hosting config
├── .firebaserc.example         # Sample Firebase project mapping
├── .github/workflows/
│   └── firebase-hosting.yml    # Automated GitHub Actions deployment
├── assets/                     # PWA PNG icons, SVG logo, sample studio photo
└── tools/
    ├── registry.js             # Central tool catalog (50+ tools)
    ├── utils.js                # Shared validation, dropzones, progress, history
    ├── photo-tools.js          # Photo editing suite
    ├── qr-tools.js             # QR Code studio
    ├── barcode-tools.js        # Barcode studio
    ├── file-tools.js           # File & document conversion suite
    ├── link-tools.js           # Direct link & URL-to-PDF tools
    ├── media-tools.js          # Audio & video processing suite
    ├── youtube-tools.js        # Official YouTube Data API & oEmbed inspector
    ├── pages.js                # About, Contact, Privacy, Terms, Disclaimer
    ├── firebase-optional.js    # Optional Firebase Auth & Analytics integration
    └── workers/
        ├── image-worker.js     # Web Worker for segmentation & convolution filters
        ├── gif-worker.js       # Web Worker for GIF89a LZW encoding
        └── audio-worker.js     # Web Worker for MP3 & WAV encoding
```

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Production Build

```bash
npm run build
```

Builds optimized assets into `dist/` and copies `assets/`, `manifest.webmanifest`, `sw.js`, `ads.txt`, `robots.txt`, and `sitemap.xml`.

## Deploying to Firebase Hosting

1. Copy `.firebaserc.example` to `.firebaserc` and replace `your-firebase-project-id` with your Firebase Project ID.
2. Install the Firebase CLI and log in:
   ```bash
   npm install -g firebase-tools
   firebase login
   ```
3. Build and deploy:
   ```bash
   npm run build
   firebase deploy --only hosting
   ```

### GitHub Actions Automated Deployment

1. Run `firebase init hosting:github` or generate a service account JSON in Google Cloud Console with **Firebase Hosting Admin** permission.
2. Add two secrets to your GitHub repository (`Settings → Secrets and variables → Actions`):
   - `FIREBASE_PROJECT_ID`: Your Firebase project ID.
   - `FIREBASE_SERVICE_ACCOUNT`: The JSON contents of your Firebase service account key.
3. Push to `main`. `.github/workflows/firebase-hosting.yml` automatically builds and deploys `dist/` to Firebase Hosting.

## Configuring Optional Integrations

- **YouTube Data API v3**: Never commit API keys to Git. Users can enter their own free Google Cloud YouTube Data API v3 key directly inside the YouTube tool's **API Settings** panel (stored locally in `localStorage`).
- **Google AdSense**: Update `ads.txt` with your `pub-XXXXXXXXXXXXXXXX` Publisher ID and replace the `ad-slot` placeholders in `index.html` / `script.js` with your `<ins class="adsbygoogle">` units.
- **Firebase Auth & Analytics (Optional)**: Users or admins can attach their Firebase Web Config object in the Settings/Account modal or via `window.FLYAI_FIREBASE_CONFIG` before `script.js` loads. Basic tools require no sign-in.
