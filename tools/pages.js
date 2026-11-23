import {
  clearDownloadHistory,
  escapeHtml,
  formatBytes,
  getDownloadHistory,
  showToast,
} from './utils.js';
import { TOOLS, getIconSvg } from './registry.js';

export function renderInfoPage(container, pageId, appState) {
  if (pageId === 'about') {
    container.innerHTML = `
      <article class="prose-card">
        <h1>About FlyAI Tools</h1>
        <p class="lead">FlyAI Tools is an all-in-one, privacy-first utility suite built with pure HTML5, CSS3, and Vanilla JavaScript so creators, students, and developers can edit images, convert documents, generate QR &amp; barcodes, and process audio or video directly in their browser.</p>
        <div class="feature-columns">
          <div>
            <h2>Client-Side Architecture</h2>
            <p>Instead of uploading private photos, contracts, or audio recordings to remote servers, FlyAI Tools leverages HTML5 Canvas 2D, Web Audio API, PDF.js, JSZip, and dedicated Web Workers directly on your device.</p>
          </div>
          <div>
            <h2>Built for Mobile &amp; Desktop</h2>
            <p>Designed mobile-first for Android and iOS browsers with 44px+ touch targets, installable PWA offline caching, and full keyboard-friendly desktop workspaces.</p>
          </div>
        </div>
      </article>
    `;
    return;
  }

  if (pageId === 'contact') {
    container.innerHTML = `
      <article class="prose-card">
        <h1>Contact Us</h1>
        <p class="lead">Have feedback, found a bug, or want to suggest a new browser utility? Reach out directly below.</p>
        <form id="contact-form" class="contact-form">
          <div class="grid-2">
            <div class="field-group">
              <label for="c-name">Your Name</label>
              <input type="text" id="c-name" required placeholder="Alex Morgan" />
            </div>
            <div class="field-group">
              <label for="c-email">Email Address</label>
              <input type="email" id="c-email" required placeholder="you@example.com" />
            </div>
          </div>
          <div class="field-group">
            <label for="c-subject">Subject</label>
            <input type="text" id="c-subject" required placeholder="Feature request or support question" />
          </div>
          <div class="field-group">
            <label for="c-message">Message</label>
            <textarea id="c-message" rows="5" required placeholder="Tell us how we can help..."></textarea>
          </div>
          <div class="btn-row">
            <button type="submit" class="btn btn-primary">Compose Email Message</button>
            <button type="reset" class="btn btn-secondary">Clear Form</button>
          </div>
        </form>
        <div id="contact-preview" class="info-box hidden"></div>
      </article>
    `;

    const form = container.querySelector('#contact-form');
    const preview = container.querySelector('#contact-preview');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = container.querySelector('#c-name').value.trim();
      const email = container.querySelector('#c-email').value.trim();
      const subject = container.querySelector('#c-subject').value.trim();
      const message = container.querySelector('#c-message').value.trim();
      const mailto = `mailto:support@flyai-tools.example?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`From: ${name} (${email})\n\n${message}`)}`;
      preview.classList.remove('hidden');
      preview.innerHTML = `
        <strong>Ready to send via your email client:</strong><br/>
        <span class="muted-text">Because FlyAI Tools runs as a static privacy-first platform without backend mail servers, clicking below opens your configured email app with your message pre-filled.</span>
        <div class="btn-row" style="margin-top:0.75rem">
          <a href="${escapeHtml(mailto)}" class="btn btn-primary btn-sm">Open Email Client</a>
        </div>
      `;
      showToast('Message prepared for your email app.', 'success');
    });
    return;
  }

  if (pageId === 'privacy') {
    container.innerHTML = `
      <article class="prose-card">
        <h1>Privacy Policy</h1>
        <p class="muted-text">Effective Date: November 23, 2026</p>
        <h2>1. Local Browser Processing</h2>
        <p>Photo editing, QR/barcode generation, ZIP archiving, PDF rendering, and audio/video conversion tools run locally inside your browser. Your files are never uploaded to FlyAI Tools servers.</p>
        <h2>2. Local Storage Preferences</h2>
        <p>We store your theme preference, favorite tools, recently used tools, local download history, optional YouTube Data API key, and favorite YouTube links exclusively in your browser's <code>localStorage</code>. You can clear them at any time.</p>
        <h2>3. External APIs &amp; Advertising</h2>
        <p>When using the YouTube Search or Link-to-File tools, requests are sent directly from your browser to the requested public URL or the official Google YouTube Data API v3. Google AdSense placements may use cookies in accordance with Google's advertising policies.</p>
      </article>
    `;
    return;
  }

  if (pageId === 'terms') {
    container.innerHTML = `
      <article class="prose-card">
        <h1>Terms and Conditions</h1>
        <p class="muted-text">Last Updated: November 23, 2026</p>
        <h2>1. Permitted Use</h2>
        <p>FlyAI Tools provides browser-based utilities for lawful personal, educational, and commercial workflows. You retain full ownership and responsibility for all files and media you process.</p>
        <h2>2. Third-Party Content &amp; Copyright</h2>
        <p>You may only download or convert media that you own, created, or have explicit permission to access. FlyAI Tools does not support bypassing DRM, paywalls, or platform download restrictions.</p>
        <h2>3. Warranty Disclaimer</h2>
        <p>Tools are provided "as is" without warranties of uninterrupted availability. Always retain backups of original important documents and media.</p>
      </article>
    `;
    return;
  }

  if (pageId === 'disclaimer') {
    container.innerHTML = `
      <article class="prose-card">
        <h1>Disclaimer</h1>
        <p>FlyAI Tools is an independent online utility suite. All trademarks, logos, and service names (including YouTube, Google AdSense, and Firebase) belong to their respective owners.</p>
        <p>YouTube search functionality uses the official YouTube Data API v3 and official YouTube embedded player. FlyAI Tools does not host, cache, or unlock restricted YouTube streams and strictly respects platform terms of service.</p>
        <p>Browser-based file processing depends on your device's available RAM and browser codec support.</p>
      </article>
    `;
    return;
  }

  if (pageId === 'favorites') {
    const favTools = TOOLS.filter((t) => appState.favorites.includes(t.id));
    container.innerHTML = `
      <div class="prose-card">
        <div class="flex-between">
          <div>
            <h1>Favorite Tools</h1>
            <p class="muted-text">Star any tool card to pin it here for instant one-tap access.</p>
          </div>
          <span class="tabular-nums muted-text">${favTools.length} saved</span>
        </div>
        <div class="tools-grid" style="margin-top:1.25rem">
          ${
            favTools.length
              ? favTools
                  .map(
                    (t) => `
                  <div class="tool-card" data-open-tool="${escapeHtml(t.id)}">
                    <div class="tool-card-top">
                      <div class="tool-icon-box">${getIconSvg(t.icon, 20)}</div>
                      <button type="button" class="fav-btn active" data-fav-toggle="${escapeHtml(t.id)}" aria-label="Remove from favorites">★</button>
                    </div>
                    <h3>${escapeHtml(t.name)}</h3>
                    <p>${escapeHtml(t.desc)}</p>
                  </div>
                `
                  )
                  .join('')
              : `<div class="empty-state">No favorite tools pinned yet. Browse All Tools and tap the star icon on tools you use most.</div>`
          }
        </div>
      </div>
    `;
    return;
  }

  if (pageId === 'history') {
    const list = getDownloadHistory();
    container.innerHTML = `
      <div class="prose-card">
        <div class="flex-between">
          <div>
            <h1>Local Download History</h1>
            <p class="muted-text">Stored locally on your device — never synced externally.</p>
          </div>
          ${list.length ? `<button type="button" id="clear-history-btn" class="btn btn-secondary btn-sm">Clear History</button>` : ''}
        </div>
        <div class="history-table-wrap" style="margin-top:1.25rem">
          ${
            list.length
              ? `
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>File Name</th>
                      <th>Tool</th>
                      <th>Format</th>
                      <th class="num-col">Size</th>
                      <th class="num-col">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${list
                      .map(
                        (item) => `
                      <tr>
                        <td><strong>${escapeHtml(item.filename)}</strong></td>
                        <td>${escapeHtml(item.toolName)}</td>
                        <td>${escapeHtml(item.format || 'FILE')}</td>
                        <td class="num-col tabular-nums">${escapeHtml(formatBytes(item.size))}</td>
                        <td class="num-col tabular-nums">${escapeHtml(new Date(item.timestamp).toLocaleString())}</td>
                      </tr>
                    `
                      )
                      .join('')}
                  </tbody>
                </table>
              `
              : `<div class="empty-state">No exports yet. Any image, QR code, barcode, PDF, ZIP, or audio file you export will be logged here.</div>`
          }
        </div>
      </div>
    `;
    container.querySelector('#clear-history-btn')?.addEventListener('click', () => {
      clearDownloadHistory();
      renderInfoPage(container, 'history', appState);
      showToast('Download history cleared.', 'info');
    });
  }
}
