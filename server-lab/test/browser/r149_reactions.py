"""Run standalone with Python Playwright and Chromium; all data lives in a temporary lab."""
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory() as directory, sync_playwright() as playwright:
    db = Path(directory) / 'pilot.sqlite'
    server = subprocess.Popen(['node', str(ROOT / 'server.mjs')], stdout=subprocess.PIPE,
                              text=True, env={**os.environ, 'PORT':'0', 'HOST':'127.0.0.1',
                              'MARCOSA_INVITE_CODE':'r149-only-for-local-tests', 'MARCOSA_DB_PATH':str(db)})
    try:
        base = server.stdout.readline().strip().split()[-1]
        browser = playwright.chromium.launch(executable_path=shutil.which('chromium'), args=['--no-sandbox'])
        context = browser.new_context(base_url=base, viewport={'width':390,'height':844}, reduced_motion='reduce')
        def mutate(path, payload):
            response = context.request.post('/api'+path, headers={'Origin':base}, data=payload)
            assert response.ok, (path, response.status)
        for name in ['reader149','writer149']:
            mutate('/auth/register', {'username':name,'email':name+'@example.org','password':'r149-test-passphrase',
                                     'inviteCode':'r149-only-for-local-tests'})
        mutate('/auth/login', {'email':'reader149@example.org','password':'r149-test-passphrase'})
        with sqlite3.connect(db) as records:
            for username, count in [('writer149',38),('reader149',1)]:
                owner,world,slug = records.execute('SELECT u.id,w.id,w.slug FROM worlds w JOIN users u ON u.id=w.owner_id WHERE u.username=?',(username,)).fetchone()
                for i in range(count):
                    records.execute("INSERT INTO posts(world_id,author_id,body,status,created_at,updated_at) VALUES(?,?,?,'published',1,1)",(world,owner,username+str(i)))
                if username=='writer149':
                    writer_slug = slug
        page=context.new_page()
        errors=[]
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto('/')
        own=page.locator('#feed-list article').first.locator('[data-reaction="like"]')
        expect(own).to_be_visible()
        expect(own).to_be_disabled()
        for _ in range(3):
            before=page.locator('#feed-list article.post').count()
            page.locator('#more').click()
            page.wait_for_function("n => document.querySelectorAll('#feed-list article.post').length > n",arg=before)
        last=page.locator('#feed-list article.post').last
        button=last.locator('[data-reaction="like"]')
        expect(button).to_be_enabled()
        button.click()
        expect(button).to_have_attribute('aria-pressed','true')
        page.goto('/w/'+writer_slug+'#post-1')
        target=page.locator('#post-1')
        expect(target).to_be_focused()
        expect(target.locator('[data-reaction="like"]')).to_have_attribute('aria-pressed','true')
        page.evaluate("location.hash='#world-%'")
        expect(page.locator('#world-detail')).to_be_hidden()
        assert not errors, errors
        browser.close()
        print('Passed: Chromium mobile pagination, own controls, reaction persistence, permalink focus, malformed hash')
    finally:
        server.terminate()
        server.wait(timeout=10)
