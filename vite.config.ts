═══════════════════════════════════════════════════════════════════════
  COMMIT 2 — VITE CONFIG EDIT
  Add me.html as a fourth Vite entry point
═══════════════════════════════════════════════════════════════════════

In github.dev, open vite.config.ts.

Use Ctrl+H (Find & Replace).

──────────────────────── FIND ────────────────────────
        manage: resolve(__dirname, 'manage.html'),
──────────────────────────────────────────────────────

──────────────────────── REPLACE WITH ────────────────────────
        manage: resolve(__dirname, 'manage.html'),
        me:     resolve(__dirname, 'me.html'),
──────────────────────────────────────────────────────

Click Replace (singular). Save.

Verify with Ctrl+F:
- me:     resolve  → should be 1 match
- manage: resolve  → should still be 1 match
