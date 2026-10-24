#!/usr/bin/env python3
"""Deterministic, allowlisted build of the public MARCOSA R2 Network OS preview.

This does NOT reproduce the authenticated MARCOSA social application.
Its inputs are independently reviewed public files in site/ (R21 branding included).
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path
from r22_extract_cinematic_assets import place as place_cinematic_assets
from r25_grade_cinematic_assets import place as place_director_grade

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "site"
OUTPUT = ROOT / "dist"
PUBLIC_FILES = ("index.html", "network.css", "network.js", "immersive.css", "immersive.js", "stories.html", "stories.css", "stories.js", "creator.html", "creator.css", "creator.js", "creator-vault.js", "creator-backup.js", "creator-crypto.js", "creator-standalone.js", "creator-playtest.js", "film-network.html", "film-network.css", "film-network.js", "film-continuity.js", "source-hub.html", "source-hub.css", "source-hub.js", "cinema-pilot.html", "cinema-pilot.css", "cinema-pilot.js", "film-internet-v-humanity.html", "film-protocol-zero.html", "film-adverse-judge.html", "film-signal-worlds.html", "film-opspilot.html", "film-intentgraph.html", "social.html", "social-core.css", "social-core.js", "marcosa-brand.css", "marcosa-brand.js", "marcosa-mark.svg", "marcosa-cinematic.css", "marcosa-gateway.js", "marcosa-quiet.css", "marcosa-quiet.js", "marcosa-nocturne.css", "marcosa-director.css", "marcosa-director.js", "marcosa-social-first.css", "social-journal.js", "marcosa-journal.css")
MARKER = ".marcosa-preview-generated"


def build() -> dict:
    if OUTPUT.is_symlink():
        raise RuntimeError("Refusing to use symlink output")
    if OUTPUT.exists() and not (OUTPUT / MARKER).is_file():
        raise RuntimeError("Refusing to replace non-generated dist directory")
    for name in PUBLIC_FILES:
        if not (SOURCE / name).is_file() or (SOURCE / name).is_symlink():
            raise RuntimeError(f"Required public source missing or symlink: {name}")
    html = (SOURCE / "index.html").read_text(encoding="utf-8")
    if any(anchor not in html for anchor in ('src="./network.js"', 'href="./network.css"', 'src="./immersive.js"', 'href="./immersive.css"')):
        raise RuntimeError("Preview HTML references were not found")
    if any(anchor not in html for anchor in ('id="mn-dialog"', 'id="mn-film-form"', 'id="mi-world-canvas"', 'id="mi-benchmark"', 'href="./stories.html"', 'href="./creator.html"')):
        raise RuntimeError("Expected Network OS or R5 story entry points are missing")
    stories = (SOURCE / 'stories.html').read_text(encoding='utf-8')
    if any(anchor not in stories for anchor in ('id="ms-stage"', 'id="ms-brief-form"', 'id="ms-choices"', 'src="./stories.js"', 'href="./stories.css"', 'src="./network.js"')):
        raise RuntimeError("R5 story pilot is missing an entry point or a functional control")
    creator = (SOURCE / "creator.html").read_text(encoding="utf-8")
    if any(anchor not in creator for anchor in ('id="mc-editor"', 'id="mc-preview"', 'id="mc-fields"', 'id="mc-apply"', 'id="mc-download"', 'id="mc-import"', 'id="mc-choice-list"', 'src="./creator.js"', 'href="./creator.css"')):
        raise RuntimeError("R8 creator engine is missing a functional editor or preview control")
    if any(anchor not in creator for anchor in ('id="mc-vault"', 'id="mc-save-revision"', 'id="mc-project-list"', 'id="mc-version-list"', 'id="mc-export-review"', 'src="./creator-vault.js"')):
        raise RuntimeError("R9 local project archive or review gateway is missing")
    if any(anchor not in creator for anchor in ('id="mc-backup"', 'id="mc-backup-download"', 'id="mc-backup-file"', 'src="./creator-backup.js"')):
        raise RuntimeError("R10 portable local archive backup controls are missing")
    if 'href="./creator.html"' not in stories:
        raise RuntimeError("R8 creator engine is not discoverable from Story Lab")
    if any(anchor not in creator for anchor in ('id="mc-crypto"', 'id="mc-crypto-pass"', 'id="mc-crypto-confirm"', 'id="mc-crypto-download"', 'id="mc-crypto-file"', 'src="./creator-crypto.js"')):
        raise RuntimeError("R11 encrypted vault controls or crypto source are missing")
    if any(anchor not in creator for anchor in ('id="mc-standalone"', 'id="mc-standalone-preview"', 'id="mc-standalone-download"', 'id="mc-standalone-player"', 'sandbox="allow-scripts"', 'src="./creator-standalone.js"')):
        raise RuntimeError("R12 standalone playable story export or sandbox preview is missing")
    if any(anchor not in creator for anchor in ('id="mc-playtest"', 'id="mc-playtest-files"', 'id="mc-playtest-results"', 'src="./creator-playtest.js"')):
        raise RuntimeError("R13 offline playtest analysis dashboard is incomplete")
    films = (SOURCE / "film-network.html").read_text(encoding="utf-8")
    if any(anchor not in films for anchor in (
        'id="fn-continuity"', 'id="fn14-save"', 'id="fn14-import"',
        'id="fn14-list"', 'src="./film-continuity.js"'
    )):
        raise RuntimeError("R14 offline review continuity controls are missing")
    atlas = (SOURCE / "source-hub.html").read_text(encoding="utf-8")
    if any(anchor not in atlas for anchor in (
        'id="sh-app"', 'id="sh-grid"', 'id="sh-search"',
        'src="./source-hub.js"', 'href="./source-hub.css"'
    )):
        raise RuntimeError("R15 evidence-grounded source atlas is missing")
    if 'href="./source-hub.html"' not in html:
        raise RuntimeError("R15 source atlas has no entry link from MARCOSA home")
    theater = (SOURCE / "cinema-pilot.html").read_text(encoding="utf-8")
    standalone_cinema = (SOURCE / "film-internet-v-humanity.html").read_text(encoding="utf-8")
    if any(anchor not in theater for anchor in (
        'id="cp-play"', 'id="cp-restart"', 'id="cp-film-frame"',
        'sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"',
        'src="./cinema-pilot.js"', 'href="./cinema-pilot.css"'
    )):
        raise RuntimeError("R16 real cinema player is missing or sandbox changed")
    if any(anchor not in standalone_cinema for anchor in (
        'end_human', 'end_algorithm', 'https://marcosa.club/'
    )):
        raise RuntimeError("R16 genuine source cinema snapshot is incomplete")
    # R18: require genuinely embedded keyframes and the story's post-ending bridge.
    for slug, expected in (('protocol-zero', 'network-continuation'),
                           ('adverse-judge', 'marcosa-ending-continuation')):
        playable = (SOURCE / ('film-' + slug + '.html')).read_text(encoding='utf-8')
        if not all(x in playable for x in ('data:image/webp;base64,', expected, '</html>')):
            raise RuntimeError('R18 standalone cinema is incomplete: ' + slug)
    # R19 archive-derived cinematic snapshots: exact byte identity is mandatory.
    r19 = json.loads((ROOT / 'inventory/playable_cinema_r19.json').read_text(encoding='utf-8'))
    if r19.get('release') != 'R19' or len(r19.get('films', [])) != 3:
        raise RuntimeError('R19 source provenance manifest invalid')
    for item in r19['films']:
        rel = item['file']
        name = Path(rel).name
        if Path(rel).parent.as_posix() != 'site' or name not in PUBLIC_FILES:
            raise RuntimeError('R19 unknown public cinema route: ' + str(rel))
        film = SOURCE / name
        raw = film.read_bytes()
        if hashlib.sha256(raw).hexdigest() != item['sha256'] or len(raw) != item['bytes']:
            raise RuntimeError('R19 cinema source snapshot mismatch: ' + name)
        text = raw.decode('utf-8')
        if text.count('data:image/webp;base64,') < item['embedded_webp']:
            raise RuntimeError('R19 original image resources missing: ' + name)
        if '<script src=' in text or '<link rel="stylesheet"' in text:
            raise RuntimeError('R19 unexpected remote dependencies: ' + name)
    for slug in ('signal-worlds', 'opspilot', 'intentgraph'):
        if 'data-cp-film="' + slug + '"' not in theater:
            raise RuntimeError('R19 cinema selector missing: ' + slug)
    # R21: one Orbital M brand, distinct route themes, explicit functional social preview.
    brand = (SOURCE / 'marcosa-brand.css').read_text(encoding='utf-8')
    brand_js = (SOURCE / 'marcosa-brand.js').read_text(encoding='utf-8')
    mark = (SOURCE / 'marcosa-mark.svg').read_text(encoding='utf-8')
    social = (SOURCE / 'social.html').read_text(encoding='utf-8')
    social_js = (SOURCE / 'social-core.js').read_text(encoding='utf-8')
    if not all(x in brand for x in ('m-transition', '.m-world-bar', 'data-m-world="cinema"', 'data-m-world="atlas"')):
        raise RuntimeError('R21 distinct brand design system missing')
    if 'marcosa-mark.svg' not in brand_js or 'root.location.assign' not in brand_js:
        raise RuntimeError('R21 actual brand transitions missing')
    if not all(x in mark for x in ('<svg ', '<path ', '<ellipse ')):
        raise RuntimeError('R21 Orbital M vector invalid')
    for name, identity in (('index.html', 'gateway'), ('stories.html', 'stories'),
                           ('creator.html', 'creator'), ('source-hub.html', 'atlas'),
                           ('cinema-pilot.html', 'cinema'), ('film-network.html', 'film-network'),
                           ('social.html', 'social')):
        route = (SOURCE / name).read_text(encoding='utf-8')
        if not all(x in route for x in (
            'data-m-world="' + identity + '"',
            'href="./marcosa-brand.css"',
            'src="./marcosa-brand.js"',
        )):
            raise RuntimeError('R21 brand not wired into ' + name)
    if not all(x in social for x in (
        'id="so-feed"', 'id="so-search"', 'id="so-draft-text"', 'id="so-save-draft"',
        'id="so-clear-draft"', 'src="./social-core.js"',
    )):
        raise RuntimeError('R21 functional Social Core interface missing')
    if 'localStorage' not in social_js or 'fetch(' in social_js:
        raise RuntimeError('R21 Social Core privacy boundary changed')
    if 'href="./social.html"' not in html:
        raise RuntimeError('R21 Social Core missing from home discovery')
    # R23: Social First edition with real editorial navigation and non-fictional local features.
    quiet = (SOURCE / 'marcosa-quiet.css').read_text(encoding='utf-8')
    quiet_js = (SOURCE / 'marcosa-quiet.js').read_text(encoding='utf-8')
    if not all(t in html for t in (
        'id="q23-home"', 'id="q23-title"', 'id="q23-search-input"',
        'id="q23-directory"', 'href="./social.html#so-feed"',
        'href="./social.html#so-draft"', 'src="./marcosa-quiet.js"'
    )):
        raise RuntimeError('R23 social-first home is not connected')
    if not all(t in quiet for t in (
        '--q-paper:#f3f0e9', '--q-serif:', '.q23-hero',
        'data-m-world="social"', 'prefers-reduced-motion:reduce'
    )):
        raise RuntimeError('R23 quiet luxury stylesheet is incomplete')
    if 'search.addEventListener' not in quiet_js or 'fetch(' in quiet_js:
        raise RuntimeError('R23 editorial search missing or network-unsafe')
    social_html = (SOURCE / 'social.html').read_text(encoding='utf-8')
    if not all(t in social_html for t in (
        'data-so-filter="saved"', 'id="so-personal-note"',
        'id="so-personal-note-body"'
    )):
        raise RuntimeError('R23 Social Core UI does not expose saved feed/private note')
    for page in ('index.html','social.html','cinema-pilot.html','creator.html',
                 'source-hub.html','stories.html','film-network.html'):
        if 'href="./marcosa-quiet.css"' not in (SOURCE / page).read_text(encoding='utf-8'):
            raise RuntimeError('R23 theme not applied to '+page)
    # R24: approved NOCTURNE is the visible dark app, not the rejected white R23 theme.
    if not all(t in html for t in ('class="m24-community"',
        'href="./social.html?view=saved#so-feed"', 'id="m22-experience"',
        'href="./marcosa-nocturne.css"')):
        raise RuntimeError('R24 real social-first dark Gateway missing')
    nocturne = (SOURCE / 'marcosa-nocturne.css').read_text(encoding='utf-8')
    for selector in ('html[data-m-world="gateway"] .m22-experience',
        'html[data-m-world="gateway"] .q23-home',
        'html[data-m-world="social"] .so-hero',
        'html[data-m-world="cinema"] .cp-hero',
        'html[data-m-world="creator"] .mc-hero',
        'html[data-m-world="atlas"] .sh-hero'):
        if selector not in nocturne:
            raise RuntimeError('R24 missing actual world theme: '+selector)
    for page in ('index.html','social.html','cinema-pilot.html','creator.html',
                 'source-hub.html','stories.html','film-network.html'):
        if 'href="./marcosa-nocturne.css"' not in (SOURCE / page).read_text(encoding='utf-8'):
            raise RuntimeError('R24 dark theme not connected in '+page)
    if 'view' not in (SOURCE / 'social-core.js').read_text(encoding='utf-8'):
        raise RuntimeError('R24 saved-only deep link not supported')
    # R25: director-grade visual layer plus native interactive film-selector.
    if not all(t in html for t in (
        'href="./marcosa-director.css"', 'src="./marcosa-director.js"',
        'id="m25-scene-chooser"', 'data-m25-scene="city"',
        'data-m25-scene="cinema"', 'data-m25-scene="studio"'
    )):
        raise RuntimeError("R25 interactive scene controls absent")
    director_css = (SOURCE / "marcosa-director.css").read_text(encoding="utf-8")
    if not all(t in director_css for t in (
        "visual-city-director.webp", "visual-cascade-director.webp",
        "visual-hero-director.webp", "prefers-reduced-motion:reduce"
    )):
        raise RuntimeError("R25 sourced high-quality design theme not connected")
    for page in ("index.html", "social.html", "cinema-pilot.html", "creator.html",
                 "source-hub.html", "stories.html", "film-network.html"):
        if 'href="./marcosa-director.css"' not in (SOURCE / page).read_text(encoding="utf-8"):
            raise RuntimeError("R25 visual identity is missing from " + page)
    # R26: the visible social application is the product, not a fullscreen splash.
    if not all(t in social for t in (
        'class="s26-quick"', 'id="so-saved-count"',
        'href="./social.html?view=saved#so-feed"',
        'href="./marcosa-social-first.css"', 'id="so-feed"', 'id="so-draft"'
    )):
        raise RuntimeError("R26 real feed-first social UX missing")
    social_first_css = (SOURCE / "marcosa-social-first.css").read_text(encoding="utf-8")
    if not all(t in social_first_css for t in (
        ".s26-quick", ".so-cards", "visual-hero-director.webp",
        "@media(max-width:720px)", "prefers-reduced-motion:reduce"
    )):
        raise RuntimeError("R26 social feed-first layout missing")
    if "const quickCount=$('so-saved-count');" not in social_js:
        raise RuntimeError("R26 saved count not connected to real local data")
    # R27: a genuinely functional private multi-entry journal must ship in the
    # real Social page. Its storage is browser-only and cannot claim publication.
    if not all(t in social for t in (
        'id="so-journal"', 'id="s27-editor"', 'id="s27-list"',
        'id="s27-export"', 'id="s27-import"', 'id="s27-undo"',
        'href="./marcosa-journal.css"', 'src="./social-journal.js"'
    )):
        raise RuntimeError("R27 private journal interface missing")
    journal_js = (SOURCE / "social-journal.js").read_text(encoding="utf-8")
    for token in ("maxItems:MAX_ITEMS", "localOnly:true", "JSON.parse",
                  "root.localStorage.setItem", "list.replaceChildren",
                  "locked=true"):
        if token not in journal_js:
            raise RuntimeError("R27 private journal safety/function missing: " + token)
    for token in ("innerHTML", "XMLHttpRequest", "fetch(", "sendBeacon("):
        if token in journal_js:
            raise RuntimeError("R27 unsafe editor or remote data flow: " + token)
    # R22: the cinematic home is an actual navigable interface, not a flat poster.
    required_r22 = (
        'id="m22-experience"', 'class="m22-gateway-sidebar"',
        'id="m22-world-search"', 'href="./social.html"',
        'href="./cinema-pilot.html"', 'href="./creator.html"',
        'href="./source-hub.html"', 'src="./marcosa-gateway.js"'
    )
    if any(token not in html for token in required_r22):
        raise RuntimeError("R22 live cinematic gateway is incomplete")
    if 'href="./cinema-pilot.html"' not in html or 'href="./cinema-pilot.html"' not in atlas:
        raise RuntimeError("R16 public cinema is not reachable from MARCOSA landing and source atlas")
    manifest = {"release_kind": "public_static_preview_only", "files": {}}
    tmp = Path(tempfile.mkdtemp(prefix=".dist-pending-", dir=ROOT))
    try:
        for name in PUBLIC_FILES:
            raw = (SOURCE / name).read_bytes()
            cap = 4_000_000 if name in ("film-protocol-zero.html", "film-adverse-judge.html", "film-signal-worlds.html", "film-opspilot.html", "film-intentgraph.html") else 512_000
            if len(raw) > cap:
                raise RuntimeError(f"Unexpected oversized source: {name}")
            (tmp / name).write_bytes(raw)
            manifest["files"][name] = hashlib.sha256(raw).hexdigest()
        # R22 sourced cinematic WebP artwork; no new image generation or external dependency.
        place_cinematic_assets(SOURCE, tmp, manifest)
        # R25 master-grade of source-owned images; original frame bytes kept intact.
        place_director_grade(tmp, manifest)
        (tmp / "build-manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        (tmp / MARKER).write_text("Generated MARCOSA Network OS preview\n", encoding="utf-8")
        if OUTPUT.exists():
            shutil.rmtree(OUTPUT)
        os.replace(tmp, OUTPUT)
    finally:
        if tmp.exists():
            shutil.rmtree(tmp)
    return manifest


if __name__ == "__main__":
    m = build()
    print(json.dumps(m, ensure_ascii=False, indent=2))
